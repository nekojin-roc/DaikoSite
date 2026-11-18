import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { ImportError } from '../importer.mjs';

async function withServer(runImport, testBody) {
  const server=createServer({isConnected:() => true},runImport);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try { await testBody(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post=(base,body) => fetch(`${base}/import`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('endpoint accepts only a provider event URL and propagates result', async () => {
  let calls=0;
  await withServer(async (_browser,url) => {calls++;return {name:url.href,image:'AA==',contentType:'image/webp',extension:'.webp'};},async base => {
    assert.equal((await fetch(`${base}/health`)).status,200);
    assert.equal((await post(base,{url:'https://127.0.0.1/e/x'})).status,400);
    assert.equal((await post(base,{url:'https://livepocket.jp/e/x',extra:'x'})).status,400);
    const response=await post(base,{url:'https://t.livepocket.jp/e/x'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).name,'https://livepocket.jp/e/x');
    assert.equal(calls,1);
  });
});

test('concurrency limit rejects a second request, then recovers', async () => {
  let release, started;
  const start = new Promise(resolve => {started=resolve;});
  const pending = new Promise(resolve => {release=resolve;});
  await withServer(async () => {started();await pending;return {name:'Event'};},async base => {
    const first=post(base,{url:'https://livepocket.jp/e/x'});
    await start;
    assert.equal((await post(base,{url:'https://livepocket.jp/e/x'})).status,503);
    release();
    assert.equal((await first).status,200);
  });
});

test('import failures are reported without leaking arbitrary exception details', async () => {
  await withServer(async () => {throw new Error('private detail');},async base => {
    const result=await post(base,{url:'https://livepocket.jp/e/x'});
    assert.equal(result.status,502);
    assert.equal((await result.json()).error,'Import failed');
  });
  await withServer(async () => {throw new ImportError(504,'Timed out');},async base => {
    const result=await post(base,{url:'https://livepocket.jp/e/x'});
    assert.equal(result.status,504);
    assert.equal((await result.json()).error,'Timed out');
  });
});
