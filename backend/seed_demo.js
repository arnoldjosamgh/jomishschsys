const path = require('path');

async function seedDemoTenant(db, asyncLocalStorage) {
    console.log('[SEED] Checking demo tenant data...');
    
    // For SQLite: there's only one database, so we just need to seed once.
    // We use a marker in app_settings to track if demo data has been inserted.
    // For Postgres: we run inside the t_demo schema context.
    
    const isPostgres = !!db.createCompanySchema;
    
    if (isPostgres) {
        try {
            await db.createCompanySchema('DEMO');
        } catch (err) {
            if (!err.message.includes('already exists')) {
                console.error('[SEED] Error creating DEMO schema:', err.message);
            }
        }
    }
    
    const schemaName = isPostgres ? 't_demo' : 'public';
    
    await new Promise((resolve) => {
        const runSeed = () => {
            // Check if already seeded by counting products
            db.get(`SELECT COUNT(*) as cnt FROM products WHERE name LIKE 'Demo%'`, [], (err, row) => {
                if (err) {
                    console.error('[SEED] Error checking products:', err.message);
                    return resolve();
                }
                if (row && row.cnt > 0) {
                    console.log('[SEED] Demo tenant is already populated. Skipping seed.');
                    return resolve();
                }
                
                console.log('[SEED] Populating demo tenant with dummy data...');
                
                // 1. Insert Demo Employees
                const employees = [
                    { first_name: 'Demo Alice', last_name: 'Manager', role: 'HR', is_active: 1 },
                    { first_name: 'Demo Bob', last_name: 'Cashier', role: 'Cashier', is_active: 1 },
                    { first_name: 'Demo Charlie', last_name: 'Driver', role: 'Transport', is_active: 1 },
                    { first_name: 'Demo Diana', last_name: 'Admin', role: 'Secretary', is_active: 1 },
                    { first_name: 'Demo Evan', last_name: 'Finance', role: 'CEO', is_active: 1 }
                ];
                
                employees.forEach(emp => {
                    db.run(`INSERT INTO employees (first_name, last_name, role, is_active) VALUES (?, ?, ?, ?)`, 
                        [emp.first_name, emp.last_name, emp.role, emp.is_active]);
                });

                // 2. Insert Demo Products (using correct column names)
                const products = [
                    { name: 'Demo - Wireless Mouse', sku: 'WM-01', price: 25.99, stock: 150, category: 'Electronics' },
                    { name: 'Demo - Mechanical Keyboard', sku: 'MK-02', price: 89.50, stock: 45, category: 'Electronics' },
                    { name: 'Demo - Ergonomic Chair', sku: 'EC-03', price: 199.99, stock: 12, category: 'Furniture' },
                    { name: 'Demo - Standing Desk', sku: 'SD-04', price: 350.00, stock: 8, category: 'Furniture' },
                    { name: 'Demo - Noise Cancelling Headphones', sku: 'NCH-05', price: 120.00, stock: 30, category: 'Electronics' },
                    { name: 'Demo - Coffee Mug', sku: 'CM-06', price: 12.50, stock: 200, category: 'Office Supplies' },
                    { name: 'Demo - Notebook 5-pack', sku: 'NB-07', price: 15.00, stock: 100, category: 'Office Supplies' },
                    { name: 'Demo - Gel Pens (Box of 12)', sku: 'GP-08', price: 8.99, stock: 85, category: 'Office Supplies' },
                    { name: 'Demo - Desk Lamp', sku: 'DL-09', price: 34.00, stock: 25, category: 'Furniture' },
                    { name: 'Demo - USB-C Hub', sku: 'UH-10', price: 45.00, stock: 60, category: 'Electronics' }
                ];
                
                products.forEach(p => {
                    db.run(`INSERT INTO products (name, category, price, stock) VALUES (?, ?, ?, ?)`, 
                        [p.name, p.category, p.price, p.stock]);
                });

                // 3. Insert Demo Transactions using CORRECT columns: type, description, recorded_by
                const now = new Date();
                const txTypes = ['INCOME', 'INCOME', 'INCOME', 'EXPENSE', 'INCOME'];
                const txDescs = ['POS Sale', 'Product Sale', 'Service Revenue', 'Operating Expense', 'Delivery Income'];
                for (let i = 0; i < 40; i++) {
                    const daysAgo = Math.floor(Math.random() * 30);
                    const txDate = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
                    const amount = parseFloat((Math.random() * 500 + 10).toFixed(2));
                    const typeIdx = Math.floor(Math.random() * txTypes.length);
                    const txType = txTypes[typeIdx];
                    const txDesc = txDescs[typeIdx];
                    const recordedBy = Math.floor(Math.random() * 5) + 1;
                    
                    db.run(`INSERT INTO transactions (amount, type, description, recorded_by, transaction_date, payment_status) VALUES (?, ?, ?, ?, ?, ?)`, 
                        [amount, txType, txDesc, recordedBy, txDate.toISOString(), 'PAID']);
                }

                // 4. Insert Demo Attendance using CORRECT table and columns: attendance_logs
                for (let empId = 1; empId <= 5; empId++) {
                    for (let d = 0; d < 7; d++) {
                        const dayDate = new Date(now.getTime() - (d * 24 * 60 * 60 * 1000));
                        const checkInHour = 8 + Math.floor(Math.random() * 2);
                        const checkInDate = new Date(dayDate.setHours(checkInHour, Math.floor(Math.random() * 60)));
                        const checkOutDate = new Date(checkInDate.getTime() + (8 * 60 * 60 * 1000));
                        
                        db.run(`INSERT INTO attendance_logs (employee_id, scan_time, scan_type, status) VALUES (?, ?, ?, ?)`, 
                            [empId, checkInDate.toISOString(), 'IN', 'PRESENT']);
                        db.run(`INSERT INTO attendance_logs (employee_id, scan_time, scan_type, status) VALUES (?, ?, ?, ?)`, 
                            [empId, checkOutDate.toISOString(), 'OUT', 'PRESENT']);
                    }
                }

                // 5. Insert Demo Calendar Events
                const events = [
                    { title: 'Team Standup Meeting', event_date: new Date().toISOString().split('T')[0], event_type: 'Meeting', start_time: '09:00', end_time: '09:30' },
                    { title: 'Q3 Performance Review', event_date: new Date(now.getTime() + 2*24*60*60*1000).toISOString().split('T')[0], event_type: 'Review', start_time: '14:00', end_time: '16:00' },
                    { title: 'Office Supplies Restocking', event_date: new Date(now.getTime() + 5*24*60*60*1000).toISOString().split('T')[0], event_type: 'Task', start_time: '10:00', end_time: '11:00' },
                ];
                events.forEach(e => {
                    db.run(`INSERT INTO calendar_events (title, event_date, event_type, start_time, end_time) VALUES (?, ?, ?, ?, ?)`,
                        [e.title, e.event_date, e.event_type, e.start_time, e.end_time]);
                });
                
                console.log('[SEED] Demo tenant dummy data inserted successfully.');
                resolve();
            });
        };

        if (isPostgres) {
            asyncLocalStorage.run(schemaName, runSeed);
        } else {
            runSeed();
        }
    });
}

module.exports = { seedDemoTenant };
