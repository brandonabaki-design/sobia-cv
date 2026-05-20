const https = require('https');

exports.handler = async (event, context) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const parsed = JSON.parse(event.body || '{}');
        const token = parsed.token;

        if (!token) {
            return {
                statusCode: 400,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Missing credential token' })
            };
        }

        // Return promise wrapper for https request compatibility
        return new Promise((resolve) => {
            https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, (googleRes) => {
                let googleData = '';
                googleRes.on('data', chunk => { googleData += chunk; });
                googleRes.on('end', () => {
                    const payload = JSON.parse(googleData || '{}');
                    
                    if (payload.error_description || !payload.email) {
                        resolve({
                            statusCode: 401,
                            headers: { 
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*'
                            },
                            body: JSON.stringify({ error: 'Invalid Google Identity token' })
                        });
                        return;
                    }

                    const whitelistedEmail = 'brandon.abaki@gmail.com';
                    if (payload.email.toLowerCase() === whitelistedEmail.toLowerCase()) {
                        resolve({
                            statusCode: 200,
                            headers: { 
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*'
                            },
                            body: JSON.stringify({
                                success: true,
                                email: payload.email,
                                name: payload.name || 'Brandon Abaki',
                                picture: payload.picture || null
                            })
                        });
                    } else {
                        resolve({
                            statusCode: 403,
                            headers: { 
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*'
                            },
                            body: JSON.stringify({ error: 'Access Denied: Email is not whitelisted' })
                        });
                    }
                });
            }).on('error', (err) => {
                resolve({
                    statusCode: 500,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ error: 'Google validation API unreachable' })
                });
            });
        });

    } catch (err) {
        return {
            statusCode: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Internal server error parsing request' })
        };
    }
};
