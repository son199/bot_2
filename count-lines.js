import fs from "fs";
import path from "path";

const excludeDirs = ["node_modules", ".git", "dist", "build"];
const exts = [".js", ".ts", ".tsx", ".jsx"]; // chỉ đếm file code

function walk(dir) {
  let results = [];
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (!excludeDirs.includes(dirent.name)) {
        results = results.concat(walk(full));
      }
    } else {
      if (exts.length === 0 || exts.includes(path.extname(dirent.name))) {
        results.push(full);
      }
    }
  }
  return results;
}

const files = walk(process.cwd());
let total = 0;

for (const file of files) {
  try {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r\n|\r|\n/).length;
    total += lines;
  } catch (err) {
    // bỏ qua file lỗi hoặc binary
  }
}

console.log("📁 Files counted:", files.length);
console.log("📄 Total lines:", total);
