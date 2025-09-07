const { createTables, seedDatabase } = require('./schema');

const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');
    
    await createTables();
    await seedDatabase();
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
};

// Run initialization if this file is executed directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase;
