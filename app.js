const express = require('express');
const app = express();
const cors = require('cors');
app.use(express.json());
app.use(cors());
const usersRouter = require('./users');
const riderRouter = require('./riders');
app.use('/users', usersRouter);
app.use('/riders', riderRouter);

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
