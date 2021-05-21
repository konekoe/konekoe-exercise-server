const { generalLogger } = require("konekoe-server-log");
const { createToken, getRandomInt } = require("konekoe-server-utils");
const { MongoConnection, clearData, closeConnections, examModels, exerciseModels } = require("konekoe-database");
const { TOKEN_SIGN_OPTIONS, JWT_PRIVATE } = require("../src/utils/Config.js");

// Registered later
let services = {};
let testServices = {};

const studentId = "Teppo_Testaaja";

// Dummy for the MessageHandler class
let messageHandler = {
  logger: generalLogger,
  studentId: studentId
};



beforeAll(async () => {
  try {
    process.examDb = await MongoConnection("DUMMY");
    generalLogger.serverInfo("Connected to exam database");
    examModels(process.examDb);
    
    process.exerciseDb = await MongoConnection("DUMMY");
    generalLogger.serverInfo("Connected to exercise database");
    exerciseModels(process.exerciseDb);

    testServices = require("./services.js");


    services = require("../src/services/connection.js");

    // Bind handler function to message handler object.
    messageHandler.server_connect = require("../src/handlers/connection.js").server_connect.bind(messageHandler);
    messageHandler.submission_fetch = require("../src/handlers/messages.js").submission_fetch.bind(messageHandler);

    generalLogger.serverInfo("Create temp directory for file path testing.");
    testServices.createTempDir();

  }
  catch (err) {
    return Promise.reject(err);
  }
});

afterAll(async () => {
  await closeConnections([process.examDb, process.exerciseDb]);
  generalLogger.serverInfo("Closed database connections");
  await testServices.removeTempDir();
});

// Note: Simple test case used when CI and CD was set up. 
describe("student ", () => {

  beforeAll(async () => {
    await testServices.addStudent(studentId);  
  });


  afterAll(async () => {
    await clearData([process.examDb, process.exerciseDb]);
  });

  it("can be found with id", async () => {
    const stud = await services.findStudent(studentId);

    expect(stud)
      .not
      .toBeNull();
  });
});

describe("connection should fail ", () => {
  let malformedToken = "";
  let validToken = "";

  beforeAll(() => {
    validToken = createToken(
      { studentId, examCode: "1234" },
      JWT_PRIVATE,
      TOKEN_SIGN_OPTIONS
      );

      malformedToken = validToken.slice(validToken.length - 1);
  });

  afterAll(async () => {
    await clearData([process.examDb, process.exerciseDb]);
  });

  it("when no auth token is received", async () => {
    return expect(messageHandler.server_connect({}))
    .rejects
    .toThrow("Invalid payload.");
  });

  it("when auth token is malformed", async () => {
    return expect(messageHandler.server_connect({
      token: malformedToken
    }))
    .rejects
    .toThrow("jwt malformed");
  });

  it("when the student is not in the database", async () => {
    return expect(messageHandler.server_connect({
      token: validToken
    }))
    .rejects
    .toThrow("No student found.");
  });

  it("when the exam is not in the database", async () => {
    await testServices.addStudent(studentId);

    return expect(messageHandler.server_connect({
      token: validToken
    }))
    .rejects
    .toThrow("Invalid exam.");
  });
});

describe("student with no exam results for the exam ", () => {
  let validToken = "";
  let testExam = {};

  beforeAll(async () => {
    try {
      await testServices.addStudent(studentId);

      // Add exam with two exercises and four variants each.
      const exerciseConfig = await testServices.createExercises(2, 4);

      testExam = await testServices.createExam(exerciseConfig);

      validToken = createToken(
        { studentId, examCode: testExam.examCode },
        JWT_PRIVATE,
        TOKEN_SIGN_OPTIONS
        );
    }
    catch (err) {
      return Promise.reject(err);
    }
  });

  afterAll(async () => {
    await clearData([process.examDb, process.exerciseDb]);
  });
  
  it("should be able to connect", async () => {
    // Check return message structure here.
    // The message should contain an array of exercises
    // Each exercise should have a title, an id, points, a description and list of submissions which can be an empty array.

    const response = await messageHandler.server_connect({
      token: validToken
    });

    response.exercises.forEach(exercise => {
      expect(exercise).toEqual(expect.objectContaining({
        title: expect.any(String),
        points: expect.any(Number),
        maxPoints: expect.any(Number),
        id: expect.any(String),
        description: expect.any(String),
        submissions: expect.any(Array)
      }));
    });
  });

  it("should receive the same result on 50 reconnects", async () => {
    let result = await Promise.all(Array(50).fill({}).map(o => messageHandler.server_connect({
      token: validToken
    })));

    // NOTE: ids are ephemeral and new ids are created each time server_connect is called.
    // We could only allow a single active set of ids for each user i.e. a single active connection.
    result = result.map(obj => obj.exercises.map(ex => {
      return { points: ex.points, name: ex.name }
    }));

    const firstReturn = result[0];

    return expect(result)
    .toEqual(
      expect
      .arrayContaining([
        expect
        .arrayContaining(firstReturn)
      ])
      );
  });

  it("should be able to fetch exercise template files", async () => {
    // NOTE: Override data set in before all to allow manual testing of fetched files.
    await clearData([process.examDb, process.exerciseDb]);

    await testServices.addStudent(studentId);

    // Add exam with one exercise and one variant.
    const exerciseConfig = await testServices.createExercises(1, 1);

    const testExam = await testServices.createExam(exerciseConfig);

    const validToken = createToken(
      { studentId, examCode: testExam.examCode },
      JWT_PRIVATE,
      TOKEN_SIGN_OPTIONS
    );
    // Connect to create variant map.
    const response = await messageHandler.server_connect({
      token: validToken
    });

    const exerciseId = response.exercises[0].id;

    
    const testFiles = Object.values(Object.values(exerciseConfig)[0].variants)[0].paths.map(path => ({ filename: path, data: `File at path ${ path }` }));

    expect(messageHandler.submission_fetch({
      exerciseId,
      submissionId: "DEFAULT"
    }))
    .resolves
    .toEqual(expect.objectContaining({
      exerciseId,
      submissionId: "DEFAULT",
      date: expect.any(Date),
      points: 0,
      files: testFiles
    }));
  })
});


describe("student with existing submissions ", () => {
  const testFileName = "Tepon salaisuus";
  let validToken = "";
  let testExam = {};
  let latestDate = {};
  let maxPoints = 0;
  let maxReceivedPoints = 0;
  let testExerciseResult = {};

  beforeAll(async () => {
    try {
      const studentDoc = await testServices.addStudent(studentId);

      // Add exam with 1 exercise and 1 variant.
      const exerciseConfig = await testServices.createExercises(1, 1);

      maxPoints = exerciseConfig[Object.keys(exerciseConfig)[0]].maxPoints;

      testExam = await testServices.createExam(exerciseConfig);

      validToken = createToken(
        { studentId, examCode: testExam.examCode },
        JWT_PRIVATE,
        TOKEN_SIGN_OPTIONS
        );
      
      // Create an exercise result and add some submissions
      testExerciseResult = await services.createExerciseResult(studentDoc._id, testExam);
      
      // NOTE: Submission files and template files don't have to have the same name.
      // When only considering what the database requires, there doesn't even need to be an equal amount of files.
      // However, if there are differences integration with a grader might fail. 
      for (let index in Array(10).fill(1)) {

        latestDate = new Date(Date.now()*index);
        const points = getRandomInt(0, maxPoints);

        maxReceivedPoints = Math.max(maxReceivedPoints, points);
        
        await testServices.createSubmission(
          testExerciseResult, 
          testExerciseResult.exercises[0].variant,
          { [testFileName]: `The date is ${ latestDate }` },
          points,
          "",
          latestDate
        );
      };
    }
    catch (err) {
      return Promise.reject(err);
    }
  });

  afterAll(async () => {
    await clearData([process.examDb, process.exerciseDb]);
    return;
  });

  it("should receive list of submission ids", async () => {
    const response = await messageHandler.server_connect({
      token: validToken
    });

    response.exercises.forEach(exercise => {
      expect(exercise).toEqual(expect.objectContaining({
        submissions: expect.arrayContaining([expect.any(String)])
      }));
    });
  });

  it("should be able to fetch latest submission", async () => {
    const { exercises } = await messageHandler.server_connect({
      token: validToken
    });

    // Try fetching first submission of first exercise.
    expect(messageHandler.submission_fetch({
      exerciseId: exercises[0].id,
      submissionId: exercises[0].submissions[0]
    }))
    .resolves
    .toEqual(expect.objectContaining({
      exerciseId: exercises[0].id,
      submissionId: exercises[0].submissions[0],
      date: latestDate,
      points: expect.any(Number),
      files: [
        { filename: testFileName, data: `The date is ${ latestDate }` }
      ]
    }));
  });

  describe("should receive the largest amount of points awarded for any submission", () => {
    it("when some earlier submission received the most points", async () => {
      const date = new Date(Date.now()*10);

      // Add submission with less points than the current maximum received points
      await testServices.createSubmission(
        testExerciseResult, 
        testExerciseResult.exercises[0].variant,
        { [testFileName]: `The date is ${ date }` },
        maxReceivedPoints - 1,
        "",
        date
      );

      return expect(messageHandler.server_connect({
        token: validToken
      }))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          "exercises": expect.arrayContaining([
            expect.objectContaining({
              points: maxReceivedPoints,
            })
          ])
        })
        );
    });

    it("when the latest submission received the most points", async () => {
      const date = new Date(Date.now()*11);

      // Add submission with less points than the current maximum received points
      await testServices.createSubmission(
        testExerciseResult, 
        testExerciseResult.exercises[0].variant,
        { [testFileName]: `The date is ${ date }` },
        maxPoints + 1,
        "",
        date
      );

      return expect(messageHandler.server_connect({
        token: validToken
      }))
      .resolves
      .toEqual(
        expect
        .objectContaining({
          "exercises": expect.arrayContaining([
            expect.objectContaining({
              points: maxPoints + 1,
            })
          ])
        }));
    });
  });
});