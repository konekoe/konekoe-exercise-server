const { readFileSync } = require("fs");
const { join } = require("path");

let env = JSON.parse(readFileSync(process.env.ENV_FILE_PATH || "./.env.json"));

const PORT = env.PORT || process.env.PORT || 4000;

// Used by konekoe-database
process.env.DATABASE_AUTH = env.DATABASE_AUTH;
process.env.DATABASE_USER = env.DATABASE_USER;
process.env.DATABASE_PASS = env.DATABASE_PASS;

const EXAM_DATABASE_URI = env.EXAM_DATABASE_URI;
const EXERCISE_DATABASE_URI = env.EXERCISE_DATABASE_URI;


//Used in token verification.
const JWT_PUBLIC = readFileSync(join(env.JWT_PUBLIC));
const JWT_PRIVATE = (env.JWT_PRIVATE) ? readFileSync(join(env.JWT_PRIVATE)) : "";
const JWT_ISSUER = env.JWT_ISSUER;
const JWT_SUBJECT = env.JWT_SUBJECT;
const JWT_AUDIENCE = env.JWT_AUDIENCE;
const JWT_EXPIRESIN = env.JWT_EXPIRESIN;
const JWT_ALGORITHM = env.JWT_ALGORITHM;

const TOKEN_VERIFY_OPTIONS = {
  issuer: JWT_ISSUER,
  subject: JWT_SUBJECT,
  audience: JWT_AUDIENCE,
  expiresIn: JWT_EXPIRESIN,
  algorithm: [ JWT_ALGORITHM ]
};

const TOKEN_SIGN_OPTIONS = {
  issuer: JWT_ISSUER,
  subject: JWT_SUBJECT,
  audience: JWT_AUDIENCE,
  expiresIn: JWT_EXPIRESIN,
  algorithm: JWT_ALGORITHM
};

const DOCKER_HOST = env.DOCKER_HOST || "localhost";
const DOCKER_CA_CERT = readFileSync(env.DOCKER_CA_CERT);
const DOCKER_CLIENT_CERT = readFileSync(env.DOCKER_CLIENT_CERT);
const DOCKER_CLIENT_KEY = readFileSync(env.DOCKER_CLIENT_KEY);

const GRADER_CONTAINER_IMAGE = env.GRADER_CONTAINER_IMAGE;
const GRADER_INTERNAL_TIMEOUT = env.GRADER_INTERNAL_TIMEOUT;
const GRADER_EXTERNAL_TIMEOUT = env.GRADER_EXTERNAL_TIMEOUT;

const GRADER_CMD = env.GRADER_CMD;
const GRADER_WORKING_DIR = env.GRADER_WORKING_DIR;
const GRADER_RESULT_DIR = env.GRADER_RESULT_DIR;
const GRADER_ERROR_DIR = env.GRADER_ERROR_DIR || "/home/student/grader/";

const GRADER_PATH = env.GRADER_PATH || "/var/grader";

const graderVolumeTargets = env.GRADER_CONTAINER_VOLUME_TARGETS;
const graderVolumeSources = env.GRADER_CONTAINER_VOLUME_SOURCES;
const graderVolumePermissions = env.GRADER_CONTAINER_VOLUME_PERMISSIONS;
const graderVolumeTypes = env.GRADER_CONTAINER_VOLUME_TYPES || [];

if (graderVolumeTargets.length !== graderVolumeSources.length || graderVolumeTargets.length !== graderVolumePermissions.length )
  throw Error("Grader volume fields have to be the same length!");

const GRADER_CONTAINER_VOLUMES = graderVolumeTargets.map((Target, index) => ({
  Target,
  Source: graderVolumeSources[index],
  ReadOnly: graderVolumePermissions[index],
  type: graderVolumeTypes[index] || "volume"
}));


module.exports = {
  PORT,
  EXAM_DATABASE_URI,
  EXERCISE_DATABASE_URI,
  TOKEN_SIGN_OPTIONS,
  TOKEN_VERIFY_OPTIONS,
  JWT_PUBLIC,
  JWT_PRIVATE,
  DOCKER_HOST,
  DOCKER_CA_CERT,
  DOCKER_CLIENT_CERT,
  DOCKER_CLIENT_KEY,
  GRADER_CONTAINER_IMAGE,
  GRADER_CONTAINER_VOLUMES,
  GRADER_EXTERNAL_TIMEOUT,
  GRADER_INTERNAL_TIMEOUT,
  GRADER_PATH,
  GRADER_CMD,
  GRADER_WORKING_DIR,
  GRADER_RESULT_DIR,
  GRADER_ERROR_DIR
};
