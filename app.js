#!/usr/bin/env node
const http = require('http'),
  fs = require('fs'),
  process = require('process');
const BIND_IP = '0.0.0.0';
const BIND_PORT = 8088;
const INDEX_HTML = fs.readFileSync(`${__dirname}/index.html`).toString();

function ticksClockNow() {
  // nano -> sec -> ticks(100 ticks/sec since kernel 2.6)
  return parseFloat(process.hrtime.bigint()) / (1000 * 1000 * 1000) * 100;
}

async function searchPidByName(pname) {
  const matchedPids = [];
  for (const pid of await fs.promises.readdir("/proc", { withFileTypes: true })) {
    if (!pid.isDirectory()) {
      continue;
    }
    if (isNaN(parseInt(pid.name))) {
      continue;
    }
    try {
      const comm = await fs.promises.readFile(`/proc/${pid.name}/comm`);
      if (comm.toString().includes(pname)) {
        matchedPids.push(parseInt(pid.name));
      }
    } catch (err) { }
  }
  return matchedPids.sort((a, b) => { return a - b; });
}

async function parseTaskStat(pid, tid) {
  let data = null;
  try {
    data = await fs.promises.readFile(`/proc/${pid}/task/${tid}/stat`);
  } catch (err) { }
  if (data == null) {
    return { tid: NaN };
  }
  const elems = data.toString().split(' ');
  return {
    name: elems[1],
    tid: tid,
    utime: parseInt(elems[13]),
    stime: parseInt(elems[14]),
  };
}

async function parseProcessStats(pid) {
  const promises = [];
  try {
    for (const tid of await fs.promises.readdir(`/proc/${pid}/task`, { withFileTypes: true })) {
      if (!tid.isDirectory()) {
        continue;
      }
      if (isNaN(parseInt(tid.name))) {
        continue;
      }
      promises.push(parseTaskStat(pid, parseInt(tid.name)));
    }
  } catch (err) {
    return {
      ticksClockNow: ticksClockNow(),
      threadStats: [],
    };
  }
  return {
    ticksClockNow: ticksClockNow(),
    threadStats: await Promise.all(promises),
  };
}

const httpServer = http.createServer();
// if the browser uses a pool of TCP connections, but globally access http server at 1Hz,
// then for single TCP connection, 5(default) seconds keep alive timeout might not be enough.
httpServer.keepAliveTimeout = 30*1000;
httpServer.on('request', async function (req, rsp) {
  if (req.method.toLowerCase() != 'get') {
    rsp.writeHead(405, { 'Content-Type': "text/plain; charset=UTF-8" });
    rsp.end("Method Not Allowed");
    return;
  }
  const uri = new URL(req.url, 'scheme://host');
  if (uri.pathname == "/") {
    rsp.writeHead(200, { 'Content-Type': "text/html; charset=UTF-8" });
    rsp.end(INDEX_HTML);
    return;
  }
  if (uri.pathname == "/search") {
    const pname = uri.searchParams.get("q");
    rsp.writeHead(200, { 'Content-Type': "application/json; charset=UTF-8" });
    rsp.end(JSON.stringify({
      pids: await searchPidByName(pname),
    }));
    return;
  }
  if (uri.pathname.startsWith("/stat/")) {
    const getPid = (uri) => {
      const parsedPath = decodeURI(uri.pathname).trim().match(/\/stat\/(\d+)\/?/);
      if (parsedPath == null) {
        return NaN;
      }
      const [, pid] = parsedPath;
      return parseInt(pid);
    };
    const pid = getPid(uri);
    if (isNaN(pid)) {
      rsp.writeHead(400, { 'Content-Type': "application/json; charset=UTF-8" });
      rsp.end("{}");
      return;
    }
    rsp.writeHead(200, { 'Content-Type': "application/json; charset=UTF-8" })
    rsp.end(JSON.stringify(await parseProcessStats(pid)));
    return;
  }
  rsp.writeHead(404, { 'Content-Type': "text/html; charset=UTF-8" });
  rsp.end("Not Found");
});
console.log(`starting http server at ${BIND_IP}:${BIND_PORT}...`);
httpServer.listen(BIND_PORT, BIND_IP);
