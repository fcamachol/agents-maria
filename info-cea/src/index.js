import { connect } from "cloudflare:sockets";

const ORIGIN_HOST = "34.122.65.54";
const ORIGIN_PORT = 3006;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Only proxy /recibo/* paths
    if (!url.pathname.startsWith("/recibo/")) {
      return new Response("Not Found", { status: 404 });
    }

    const path = `${url.pathname}${url.search}`;

    try {
      const socket = connect(`${ORIGIN_HOST}:${ORIGIN_PORT}`);

      // Send raw HTTP/1.1 request
      const writer = socket.writable.getWriter();
      const httpRequest =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${ORIGIN_HOST}:${ORIGIN_PORT}\r\n` +
        `User-Agent: info-cea-worker\r\n` +
        `Connection: close\r\n` +
        `\r\n`;
      await writer.write(new TextEncoder().encode(httpRequest));
      writer.releaseLock();

      // Read full response (don't close writer — Node.js closes socket on FIN)
      const reader = socket.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks into single buffer
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const raw = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }

      // Split headers from body at \r\n\r\n
      const sep = findDoubleCRLF(raw);
      if (sep === -1) {
        return new Response("Bad gateway", { status: 502 });
      }

      const headerText = new TextDecoder().decode(raw.slice(0, sep));
      const body = raw.slice(sep + 4);

      // Parse status line
      const [statusLine, ...headerLines] = headerText.split("\r\n");
      const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 502;

      // Parse response headers
      const headers = new Headers();
      for (const line of headerLines) {
        const i = line.indexOf(":");
        if (i > 0) {
          headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
        }
      }

      // If chunked, decode the body
      let responseBody = body;
      if ((headers.get("transfer-encoding") || "").includes("chunked")) {
        responseBody = decodeChunked(body);
        headers.delete("transfer-encoding");
        headers.set("content-length", String(responseBody.length));
      }

      return new Response(responseBody, { status, headers });
    } catch (error) {
      return new Response("Bad gateway", { status: 502 });
    }
  },
};

function findDoubleCRLF(bytes) {
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function decodeChunked(data) {
  const parts = [];
  let pos = 0;
  while (pos < data.length) {
    // Find end of chunk size line
    let lineEnd = pos;
    while (lineEnd < data.length - 1 && !(data[lineEnd] === 13 && data[lineEnd + 1] === 10)) {
      lineEnd++;
    }
    const sizeLine = new TextDecoder().decode(data.slice(pos, lineEnd));
    const chunkSize = parseInt(sizeLine, 16);
    if (chunkSize === 0) break;
    pos = lineEnd + 2; // skip \r\n after size
    parts.push(data.slice(pos, pos + chunkSize));
    pos += chunkSize + 2; // skip chunk data + \r\n
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    result.set(p, off);
    off += p.length;
  }
  return result;
}
