const { readFile, writeFile } = require("fs").promises;
const PACKAGE_FILE = "./package.json";
const RUNNER_AUTH_FILE = "/.auth/runner-auth.json";
async function main() {
  try {
    const packageObj = JSON.parse(await readFile(PACKAGE_FILE));
    const runnerAuth = JSON.parse(await readFile(RUNNER_AUTH_FILE));
    
    for( let key in runnerAuth) {
      if (packageObj.dependencies[key]) {
        packageObj.dependencies[key] = `git+https://${ runnerAuth[key].user }:${ runnerAuth[key].pass }@version.aalto.fi/gitlab/konekoe/${ key }`
      }
      else {
        throw Error("Dependency not found!");
      }
    }
    
    await writeFile(PACKAGE_FILE, JSON.stringify(packageObj));
  }
  catch (err) {
    console.log(err.stack);
    return exit(1);
  }
}

main();