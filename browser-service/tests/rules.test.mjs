import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRequest, eventUrl, imageFormat, imageUrl } from '../rules.mjs';

test('only canonical LivePocket event URLs are accepted', () => {
  assert.equal(eventUrl('https://livepocket.jp/e/3pnkn?from=ref#x').href, 'https://livepocket.jp/e/3pnkn');
  assert.equal(eventUrl('https://t.livepocket.jp/e/3pnkn').href, 'https://livepocket.jp/e/3pnkn');
  for (const value of ['http://livepocket.jp/e/id','https://livepocket.jp.evil.example/e/id','https://user:pw@livepocket.jp/e/id','https://livepocket.jp:8443/e/id','https://livepocket.jp/e/id/extra','https://127.0.0.1/e/id','https://livepocket.jp/e/id%2Fadmin']) assert.equal(eventUrl(value), null, value);
});

test('only the requested page, validated main images, and WAF challenge traffic are allowed', () => {
  const event=eventUrl('https://livepocket.jp/e/3pnkn');
  assert.equal(allowedRequest(event.href,'GET','document',event),true);
  assert.equal(allowedRequest('https://livepocket.jp/e/other','GET','document',event),false);
  assert.equal(allowedRequest('https://livepocket.jp/api/private','GET','fetch',event),false);
  assert.equal(allowedRequest('https://livepocket.jp/public/event_image/filename/123/original.webp','GET','fetch',event),true);
  assert.equal(allowedRequest('https://livepocket.jp/public/event_image/filename/123/original.webp','POST','fetch',event),false);
  assert.equal(allowedRequest('https://abc.def.ap-northeast-1.token.awswaf.com/challenge.js','GET','script',event),true);
  assert.equal(allowedRequest('https://abc.def.ap-northeast-1.token.awswaf.com/mp_verify','POST','fetch',event),true);
  assert.equal(allowedRequest('https://abc.def.ap-northeast-1.token.awswaf.com/inputs','GET','fetch',event),true);
  assert.equal(allowedRequest('https://abc.def.ap-northeast-1.token.awswaf.com.evil.example/challenge.js','GET','script',event),false);
  assert.equal(allowedRequest('https://abc.def.ap-northeast-1.token.awswaf.com/challenge.js','GET','websocket',event),false);
  assert.equal(allowedRequest('http://abc.def.ap-northeast-1.token.awswaf.com/challenge.js','GET','script',event),false);
});

test('image URLs and actual raster signatures are validated', () => {
  const base='https://livepocket.jp/e/3pnkn';
  assert.equal(imageUrl('/public/event_image/filename/123/full.webp',base).hostname,'livepocket.jp');
  for (const url of ['https://evil.example/public/event_image/filename/123/x.webp','https://livepocket.jp/public/event_image/filename/123/%2e%2e%2fadmin','https://livepocket.jp/public/event_image/filename/1/placeholder.webp','data:image/png;base64,eA==']) assert.equal(imageUrl(url,base),null,url);
  assert.deepEqual(imageFormat(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')),{contentType:'image/webp',extension:'.webp'});
  assert.equal(imageFormat(Buffer.from('<html>challenge</html>')),null);
});
