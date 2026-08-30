const mongoose = require('mongoose');

// Migration scripts own every schema change explicitly. This prevents a
// read-only dry run (or an ordinary production process) from creating indexes
// merely because a model was imported.
process.env.MONGOOSE_MIGRATION_MODE = 'true';
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

module.exports = mongoose;
