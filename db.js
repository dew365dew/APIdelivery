// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: '202.28.34.203',  
    user: 'mb68_65011212231', //  mb68_65011212231
    password: 'bfZ6qa7+kA*Y', //  bfZ6qa7+kA*Y
    database: 'mb68_65011212231', // mb68_65011212231
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
