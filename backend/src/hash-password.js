const bcrypt = require("bcryptjs");

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node src/hash-password.js "your-password"');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
