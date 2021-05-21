import json

PACKAGE_PATH = "./package.json"
RUNNER_AUTH_PATH = "/var/exercise-runner/runner-auth.json"

packageFile = open(PACKAGE_PATH, "r")
authFile = open(RUNNER_AUTH_PATH, "r")

packageDict = json.loads(packageFile.read())
authDict = json.loads(authFile.read())

packageFile.close()
authFile.close()

# Loop over keys in out file and replace matching dependency fields in package

def tokenUrl(package, user, password):
  return 'git+https://{user}:{password}@version.aalto.fi/gitlab/konekoe/{package}'.format(user=user, password=password, package=package)

for key in authDict:
  if key in packageDict["dependencies"]:
    packageDict["dependencies"][key] = tokenUrl(key, authDict[key]["user"], authDict[key]["pass"])

packageFile = open(PACKAGE_PATH, "w")

packageFile.write(json.dumps(packageDict))
packageFile.close()