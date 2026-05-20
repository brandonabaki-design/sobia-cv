const https = require('https');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }

    try {
        let token = '';
        if (req.body && req.body.token) {
            token = req.body.token;
        } else {
            // Manual stream reader fallback
            const buffers = [];
            for await (const chunk of req) {
                buffers.push(chunk);
            }
            const data = Buffer.concat(buffers).toString();
            const parsed = JSON.parse(data || '{}');
            token = parsed.token;
        }

        if (!token) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing credential token' }));
        }

        // Call Google Tokeninfo Endpoint to verify signature and obtain payload
        https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, (googleRes) => {
            let googleData = '';
            googleRes.on('data', chunk => { googleData += chunk; });
            googleRes.on('end', () => {
                const payload = JSON.parse(googleData || '{}');
                
                if (payload.error_description || !payload.email) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid Google Identity token' }));
                }

                // Strict email check
                const whitelistedEmail = 'brandon.abaki@gmail.com';
                if (payload.email.toLowerCase() === whitelistedEmail.toLowerCase()) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: true,
                        email: payload.email,
                        name: payload.name || 'Brandon Abaki',
                        picture: payload.picture || null
                    }));
                } else {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Access Denied: Email is not whitelisted' }));
                }
            });
        }).on('error', (err) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Google validation API unreachable' }));
        });

    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Internal server error parsing request' }));
    }
};
