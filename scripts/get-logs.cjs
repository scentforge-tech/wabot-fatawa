const fs = require('fs');
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

const sa = JSON.parse(fs.readFileSync('./firebase-service-account.json','utf8'));

const auth = new GoogleAuth({
  credentials: sa,
  scopes: ['https://www.googleapis.com/auth/logging.read'],
});

auth.getAccessToken().then(token => {
  const body = JSON.stringify({
    resourceNames: ['projects/masjidmap-5yvj5'],
    filter: 'resource.type=cloud_run_revision AND resource.labels.service_name="wabot-fatawa" AND timestamp>="2026-06-30T20:20:00Z"',
    orderBy: 'timestamp desc',
    pageSize: 50
  });
  
  const req = https.request({
    hostname: 'logging.googleapis.com',
    path: '/v2/entries:list',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      const j = JSON.parse(d);
      const entries = j.entries || [];
      console.log('Total log entries:', entries.length);
      entries.reverse().forEach(e => {
        const ts = (e.timestamp || '').slice(11,19);
        const msg = e.jsonPayload?.msg || e.textPayload || JSON.stringify(e.jsonPayload || '');
        const err = e.jsonPayload?.err ? ' ERR:' + JSON.stringify(e.jsonPayload.err).slice(0,100) : '';
        console.log(ts, msg.slice(0,150) + err);
      });
    });
  });
  req.write(body);
  req.end();
}).catch(e => console.error('Auth error:', e.message));
