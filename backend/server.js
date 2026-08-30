require('dotenv').config();

const app = require('./index');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
    console.log(`SMM backend listening on ${host}:${port}`);
});
