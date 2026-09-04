const http = require('http');

const payload = JSON.stringify({
    username: 'jomish_tech',
    password: 'JomishRecovery99!!'
});

const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const result = JSON.parse(data);
        if (!result.token) {
            console.log('Login failed:', result);
            return;
        }
        
        const token = result.token;
        const calPayload = JSON.stringify({
            title: 'Test Event',
            event_type: 'Meeting',
            event_date: '2026-06-30',
            start_time: '10:00',
            end_time: '11:00',
            description: 'Test Description',
            color: '#4F46E5'
        });

        const calReq = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/calendar/events',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(calPayload)
            }
        }, (calRes) => {
            let calData = '';
            calRes.on('data', chunk => calData += chunk);
            calRes.on('end', () => {
                console.log('Status Code:', calRes.statusCode);
                console.log('Response:', calData);
            });
        });
        calReq.write(calPayload);
        calReq.end();
    });
});

req.write(payload);
req.end();
