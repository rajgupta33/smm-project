require('dotenv').config();

const app = require('./index');

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
    console.log(`SMM backend listening on port ${port}`);
});
