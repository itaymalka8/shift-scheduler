const pool = require('./connection');

const createTables = async () => {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        permissions TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // Employees table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(50) NOT NULL,
        category VARCHAR(50),
        phone VARCHAR(20),
        email VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Vehicles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        license_plate VARCHAR(20) UNIQUE NOT NULL,
        vehicle_type VARCHAR(50) NOT NULL,
        model VARCHAR(100),
        year INTEGER,
        status VARCHAR(20) DEFAULT 'active',
        last_inspection DATE,
        next_inspection DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Shifts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        shift_type VARCHAR(50) NOT NULL,
        assignments JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, shift_type)
      )
    `);

    // Work plans table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS work_plans (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        general_tasks TEXT[] DEFAULT '{}',
        shift_tasks JSONB DEFAULT '{}',
        notes TEXT,
        start_time TIME,
        end_time TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Requests table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id),
        request_type VARCHAR(50) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        requested_date DATE,
        approved_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables created successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
};

const seedDatabase = async () => {
  try {
    // Check if users exist
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    
    if (userCount.rows[0].count === '0') {
      // Insert default users
      await pool.query(`
        INSERT INTO users (username, password, email, name, role, permissions, is_active) VALUES
        ('itaymalka8', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'itaymalka8@gmail.com', 'איתי מלכא', 'admin', 
         ARRAY['schedule_view', 'schedule_edit', 'schedule_manage', 'employees_view', 'employees_edit', 'employees_manage', 
               'vehicles_view', 'vehicles_edit', 'vehicles_manage', 'requests_view', 'requests_approve', 'requests_manage',
               'workplan_view', 'workplan_edit', 'workplan_manage', 'users_view', 'users_edit', 'users_manage',
               'system_settings', 'system_reports'], true),
        ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin@example.com', 'מנהל מערכת', 'admin',
         ARRAY['schedule_view', 'schedule_edit', 'schedule_manage', 'employees_view', 'employees_edit', 'employees_manage',
               'vehicles_view', 'vehicles_edit', 'vehicles_manage', 'requests_view', 'requests_approve', 'requests_manage',
               'workplan_view', 'workplan_edit', 'workplan_manage', 'users_view', 'users_edit', 'users_manage',
               'system_settings', 'system_reports'], true)
      `);

      // Insert default employees
      await pool.query(`
        INSERT INTO employees (name, role, category, phone, email) VALUES
        ('ניסים סויסה', 'קמ"ן', 'פיקוד', '050-1234567', 'nissim@example.com'),
        ('יונתן בדיחי', 'קמ"ן פקד', 'פיקוד', '050-2345678', 'yonatan@example.com'),
        ('דוד כהן', 'בלש', 'בילוש', '050-3456789', 'david@example.com'),
        ('שרה לוי', 'רכז', 'רכז', '050-4567890', 'sarah@example.com'),
        ('מיכאל אברהם', 'הערכה', 'הערכה/אחר', '050-5678901', 'michael@example.com')
      `);

      // Insert default vehicles
      await pool.query(`
        INSERT INTO vehicles (license_plate, vehicle_type, model, year, status) VALUES
        ('12-345-67', 'רכב משטרתי', 'Hyundai Elantra', 2020, 'active'),
        ('23-456-78', 'רכב משטרתי', 'Toyota Corolla', 2021, 'active'),
        ('34-567-89', 'רכב משטרתי', 'Kia Sportage', 2019, 'active')
      `);

      console.log('✅ Database seeded with default data');
    }
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
};

module.exports = {
  createTables,
  seedDatabase
};

