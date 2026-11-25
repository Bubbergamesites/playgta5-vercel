// "lumen-gta5" on Vercel: GTA V for Lumen, on its own address (https://YOUR-PROJECT.vercel.app/).
// playgta5.com only starts on a cross-origin isolated page. This serves the same site with the header
// Document-Isolation-Policy (isolates just this one frame) and drops the site's own COOP/COEP/CORP headers.
// Runs on its own address so the game can never reach Lumen's page.
//
// Differences from the Cloudflare version:
//  - /b/... (game files) is NOT handled here: vercel.json rewrites it straight to the site, so the still-packed
//    (br/gzip) bytes pass through untouched and no function time is spent on them.
//  - caches.default + cron is replaced by Vercel's CDN: the Vercel-CDN-Cache-Control header below keeps "/" and
//    /data/rv/online.json for 5 minutes and serves an older copy instantly while refreshing in the background.
//  - WebSockets cannot be proxied on Vercel.
const SITE = "https://playgta5.com";
const WARM = new Set(["/", "/data/rv/online.json"]);   /* slow on the site's side: kept in the CDN */
const KEEP = ["content-type", "content-range", "accept-ranges", "etag", "last-modified"];
const DROP = /^(host|origin|referer|cf-|x-forwarded|x-vercel|x-real-ip|forwarded|via|accept-encoding|sec-fetch|range|if-range|connection|content-length|transfer-encoding|upgrade)/i;
const DOWN = "The game's server isn't answering.";

// Written into the start page: the game needs WebGPU, and when the browser has none the loading screen
// just never moves. This checks the few things the game needs, says so in plain words if one is missing, and after 45 s still at <= 6 % shows what it found.
const DIAG = "<script>(function(){var box=null,res={gpu:!!navigator.gpu,adapter:null,name:''};"
  + "function ver(){var m=/(?:Chrome|CriOS)[/]([0-9]+)/.exec(navigator.userAgent);return m?m[1]:'?';}"
  + "function lines(){var cros=/CrOS/.test(navigator.userAgent);return ["
  + "'Graphics (WebGPU): '+(!res.gpu?'MISSING in this browser':res.adapter===null?'checking...':res.adapter?'ok'+(res.name?' ('+res.name+')':''):'no graphics adapter offered'),"
  + "'Isolated page (needed by the engine): '+(self.crossOriginIsolated?'yes':'NO'),"
  + "'Saved-data storage: '+(navigator.storage&&navigator.storage.getDirectory?'ok':'MISSING'),"
  + "'Memory: '+(navigator.deviceMemory||'?')+' GB, cores: '+(navigator.hardwareConcurrency||'?')+', Chrome '+ver()+(cros?' (ChromeOS)':'')];}"
  + "function show(head,bad){if(!box){box=document.createElement('div');box.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:600px;margin:0 auto;padding:12px 14px;border-radius:10px;font:13px/1.5 system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.5)';(document.body||document.documentElement).appendChild(box);}"
  + "box.style.background=bad?'rgba(120,20,20,.95)':'rgba(40,40,40,.95)';box.textContent='';var h=document.createElement('div');h.style.fontWeight='700';h.textContent=head;box.appendChild(h);"
  + "lines().forEach(function(t){var d=document.createElement('div');d.textContent=t;box.appendChild(d);});}"
  + "function hide(){if(box){box.remove();box=null;}}"
  + "var ban=null;function ask(on){if(!on){if(ban){ban.remove();ban=null;}return;}if(ban)return;ban=document.createElement('div');ban.style.cssText='position:fixed;left:50%;top:32%;transform:translateX(-50%);z-index:2147483646;text-align:center;font:600 20px/1.4 system-ui,sans-serif;color:#fff;text-shadow:0 2px 6px #000';"
  + "var t=document.createElement('div');t.textContent='Pick a mode to start loading the game';ban.appendChild(t);var row=document.createElement('div');row.style.cssText='margin-top:14px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap';"
  + "[['story','Story Mode'],['sandbox','Sandbox Mode'],['multi','Multiplayer']].forEach(function(a){var o=document.querySelector('#modes button[data-act=\"'+a[0]+'\"]');if(!o||o.hidden)return;var b=document.createElement('button');b.textContent=a[1];b.style.cssText='font:600 18px system-ui,sans-serif;padding:12px 22px;border-radius:10px;border:2px solid #fff;background:rgba(0,0,0,.7);color:#fff;cursor:pointer';b.onclick=function(){o.click();};row.appendChild(b);});"
  + "ban.appendChild(row);(document.body||document.documentElement).appendChild(ban);}"
  + "if(navigator.gpu){navigator.gpu.requestAdapter().then(function(a){res.adapter=!!a;if(a){var i=a.info||{};res.name=[i.vendor,i.architecture].filter(Boolean).join(' ');}}).catch(function(){res.adapter=false;});}else res.adapter=false;"
  + "var t0=Date.now(),bad=false;setInterval(function(){var el=document.getElementById('pct'),p=el?parseInt(el.textContent,10)||0:0,s=(Date.now()-t0)/1000;"
  + "var lb=document.getElementById('label'),ch=!!lb&&/^Choose Multiplayer/.test(lb.textContent);ask(ch&&s>3);"
  + "if(!el||p>20){hide();ask(false);return;}"
  + "if(!res.gpu||res.adapter===false){if(s>2){bad=true;show('GTA V cannot start here: this browser has no usable WebGPU (graphics) support.',true);}return;}"
  + "if(!self.crossOriginIsolated&&s>6){bad=true;show('GTA V cannot start: the page is not isolated by this browser.',true);return;}"
  + "if(s>45&&p<=6&&!ch){show('Still stuck at '+p+'% after '+(s|0)+' s. Tell Claude what the lines below say:',true);}},1500);})();<\/script>";

function outgoing(req, warm) {
  const h = new Headers();
  for (const [k, v] of req.headers) {
    if (DROP.test(k)) continue;
    if (warm && /^if-/i.test(k)) continue;   /* never let a 304 become the shared copy */
    h.set(k, v);
  }
  h.set("accept-encoding", "identity");      /* unpacked, so a body is never mislabelled; Vercel packs text for the visitor */
  return h;
}

function shape(r, u) {
  const h = new Headers();
  for (const k of KEEP) { const v = r.headers.get(k); if (v) h.set(k, v); }
  const loc = r.headers.get("location"); if (loc) h.set("location", loc.replace(SITE, ""));
  h.set("cache-control", r.ok ? "public, max-age=60" : "no-store");
  if (r.ok && /[?&]v=/.test(u.search)) h.set("cache-control", "public, max-age=31536000, immutable"); /* ?v=<version>: same address, same bytes */
  h.set("document-isolation-policy", "isolate-and-credentialless");
  h.set("cross-origin-resource-policy", "cross-origin");
  h.set("x-content-type-options", "nosniff");
  return h;
}

/* streams bytes a..b (inclusive) of a body without holding the whole file in memory */
function slice(body, a, b) {
  const reader = body.getReader();
  let pos = 0;
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return ctrl.close();
        const s = pos, e = pos + value.length; pos = e;
        if (e <= a) continue;
        ctrl.enqueue(value.subarray(Math.max(a - s, 0), Math.min(b + 1 - s, value.length)));
        if (e > b) { reader.cancel().catch(() => {}); return ctrl.close(); }
        return;
      }
    },
    cancel() { reader.cancel().catch(() => {}); }
  });
}

export default {
  async fetch(req) {
    const u = new URL(req.url), path = u.pathname + u.search, m = req.method;
    if ((req.headers.get("upgrade") || "").toLowerCase() === "websocket")
      return new Response("WebSockets can't be proxied on Vercel.", { status: 501 });
    if (m !== "GET" && m !== "HEAD" && m !== "POST") return new Response("no", { status: 405 });

    const warm = m === "GET" && u.search === "" && WARM.has(u.pathname);
    const range = m === "GET" ? req.headers.get("range") : null;
    const h = outgoing(req, warm);
    if (range) h.set("range", range);

    let r;
    try {
      r = await fetch(SITE + path, { method: m, headers: h, body: m === "POST" ? await req.arrayBuffer() : undefined, redirect: "manual" });
    } catch (e) { return new Response(DOWN, { status: 502, headers: { "cache-control": "no-store" } }); }

    if (warm && !r.ok) return new Response(DOWN, { status: 502, headers: { "cache-control": "no-store" } });

    const out = shape(r, u);

    /* the start page: with the check script put in front of everything else */
    if (warm && u.pathname === "/") {
      let html = await r.text();
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, t => t + DIAG) : DIAG + html;
      out.delete("etag"); out.delete("last-modified");
      out.set("vercel-cdn-cache-control", "max-age=300, stale-while-revalidate=86400");
      return new Response(html, { status: 200, headers: out });
    }
    if (warm) out.set("vercel-cdn-cache-control", "max-age=300, stale-while-revalidate=86400");

    let status = r.status, stream = r.body;
    const noBody = m === "HEAD" || [101, 204, 205, 304].includes(status);

    /* The site answers a Range request for an unpacked file with the whole file: the range is cut out here instead. */
    const mm = range && status === 200 && !noBody ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (mm && (mm[1] !== "" || mm[2] !== "")) {
      let len = +r.headers.get("content-length") || 0, buf = null;
      if (!len) { buf = new Uint8Array(await r.arrayBuffer()); len = buf.length; }
      const a = mm[1] === "" ? Math.max(0, len - +mm[2]) : +mm[1];
      const b = mm[1] === "" || mm[2] === "" ? len - 1 : Math.min(+mm[2], len - 1);
      if (a >= len || a > b) {
        if (!buf) r.body.cancel().catch(() => {});
        return new Response(null, { status: 416, headers: { "content-range": "bytes */" + len } });
      }
      status = 206;
      out.set("content-range", "bytes " + a + "-" + b + "/" + len);
      out.set("accept-ranges", "bytes");
      stream = buf ? buf.subarray(a, b + 1) : slice(r.body, a, b);
    }

    return new Response(noBody ? null : stream, { status, headers: out });
  }
};
