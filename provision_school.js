// This script provisions the school company if it doesn't exist yet
const http = require('http');

function post(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request({
            hostname: 'localhost',
            port: 3005,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let responseBody = '';
            res.on('data', d => responseBody += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(responseBody) }); }
                catch(e) { resolve({ status: res.statusCode, raw: responseBody }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function provision() {
    console.log('Provisioning school company...');
    
    const result = await post('/api/system/initialize', {
        company_prefix: 'SCH',
        company_name: 'School System',
        business_email: 'admin@school.edu',
        tech_password: 'Jomish9!!'
    });
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.data && result.data.tech_username) {
        console.log('\n=== SUCCESS ===');
        console.log('Login username:', result.data.tech_username);
        console.log('Default password:', result.data.default_password);
        console.log('==============');
    }
}

provision().catch(console.error).finally(() => setTimeout(() => process.exit(0), 1000));
