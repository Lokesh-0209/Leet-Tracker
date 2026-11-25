// Netlify imports this file and hosts the exported Express app.
// Keep serverApp's local auto-start disabled; Netlify owns the HTTP listener.
process.env.NETLIFY_SERVER_ENTRY = '1';

const { createFullApp } = await import('../../build/server.mjs');

export default await createFullApp();
