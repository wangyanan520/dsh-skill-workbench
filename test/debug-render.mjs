import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ORIGIN = (process.env.DSH_PLUGIN_ORIGIN || 'http://127.0.0.1:51825').replace(/\/+$/, '') + '/';
const source = fs.readFileSync(CLIENT_PATH, 'utf8');
let moduleRecord = null;
const sandbox = {
  window: { __ModuleLoader__: { load(r){ moduleRecord = r; } }, location:{pathname:'/'} },
  document: { documentElement: { lang: 'zh-CN' } },
  localStorage: { getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },
  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, URL, TextEncoder, TextDecoder, AbortController,
  fetch: async (path, options) => { const url = new URL(path, ORIGIN); const res = await fetch(url, options); const text = await res.text(); console.log('FETCH', String(url), res.status, text.length); return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } }); },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });
const plugin = moduleRecord.factory((id)=> React);
const registered = [];
const fakeCtx = { get(){return undefined;}, locale:{register:()=>()=>{}, bind:()=>(k)=>k}, slots:{ inject:(n,cb)=>{cb(); return ()=>{};}, register:(o,C)=>{registered.push({options:o,Component:C}); return ()=>{};} }, effect:()=>{} };
plugin.apply(fakeCtx);
const main = registered.find(i=>i.options.name==='main');
let renderer = null;
await act(async () => { renderer = TestRenderer.create(React.createElement(main.Component, {})); await new Promise(r=>setTimeout(r,1000)); });
const boundary = renderer.root.findAll(n => n.type && n.type.name === 'PageBoundary');
if (boundary.length && boundary[0].instance.state.error) {
  console.log('BOUNDARY ERROR MESSAGE:', boundary[0].instance.state.error.message);
  console.log('BOUNDARY ERROR STACK:', boundary[0].instance.state.error.stack);
}
console.log('TREE HEAD:', JSON.stringify(renderer.toJSON()).slice(0, 600));
