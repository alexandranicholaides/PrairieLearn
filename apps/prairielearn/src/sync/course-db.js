// @ts-check
const path = require('path');
const _ = require('lodash');
const fs = require('fs-extra');
const async = require('async');
const jju = require('jju');
const Ajv = require('ajv').default;
const betterAjvErrors = require('better-ajv-errors').default;
const { parseISO, isValid, isAfter, isFuture } = require('date-fns');
const { chalk } = require('../lib/chalk');
const { config } = require('../lib/config');

const schemas = require('../schemas');
const infofile = require('./infofile');
const jsonLoad = require('../lib/json-load');
const perf = require('./performance')('course-db');

// We use a single global instance so that schemas aren't recompiled every time they're used
const ajv = new Ajv({ allErrors: true });

const DEFAULT_QUESTION_INFO = {
  type: 'Calculation',
  clientFiles: ['client.js', 'question.html', 'answer.html'],
};
const DEFAULT_COURSE_INSTANCE_INFO = {
  groupAssessmentsBy: 'Set',
};
const DEFAULT_ASSESSMENT_INFO = {};

const DEFAULT_ASSESSMENT_SETS = [
  {
    abbreviation: 'HW',
    name: 'Homework',
    heading: 'Homeworks',
    color: 'green1',
  },
  { abbreviation: 'Q', name: 'Quiz', heading: 'Quizzes', color: 'red1' },
  {
    abbreviation: 'PQ',
    name: 'Practice Quiz',
    heading: 'Practice Quizzes',
    color: 'pink1',
  },
  { abbreviation: 'E', name: 'Exam', heading: 'Exams', color: 'brown1' },
  {
    abbreviation: 'PE',
    name: 'Practice Exam',
    heading: 'Practice Exams',
    color: 'yellow1',
  },
  {
    abbreviation: 'P',
    name: 'Prep',
    heading: 'Question Preparation',
    color: 'gray1',
  },
  {
    abbreviation: 'MP',
    name: 'Machine Problem',
    heading: 'Machine Problems',
    color: 'turquoise1',
  },
  {
    abbreviation: 'WS',
    name: 'Worksheet',
    heading: 'Worksheets',
    color: 'purple1',
  },
  { abbreviation: 'U', name: 'Unknown', heading: 'Unknown', color: 'red3' },
];

const DEFAULT_TAGS = [
  {
    name: 'numeric',
    color: 'brown1',
    description: 'The answer format is one or more numerical values.',
  },
  {
    name: 'symbolic',
    color: 'blue1',
    description: 'The answer format is a symbolic expression.',
  },
  {
    name: 'drawing',
    color: 'yellow1',
    description:
      'The answer format requires drawing on a canvas to input a graphical representation of an answer.',
  },
  {
    name: 'MC',
    color: 'green1',
    description:
      'The answer format is choosing from a small finite set of answers (multiple choice, possibly with multiple selections allowed, up to 10 possible answers).',
  },
  {
    name: 'code',
    color: 'turquoise1',
    description: 'The answer format is a piece of code.',
  },
  {
    name: 'multianswer',
    color: 'orange2',
    description:
      'The question requires multiple answers, either as steps in a sequence or as separate questions.',
  },
  {
    name: 'graph',
    color: 'purple1',
    description: 'The question tests reading information from a graph or drawing a graph.',
  },
  {
    name: 'concept',
    color: 'pink1',
    description: 'The question tests conceptual understanding of a topic.',
  },
  {
    name: 'calculate',
    color: 'green2',
    description:
      'The questions tests performing a numerical calculation, with either a calculator or equivalent software.',
  },
  {
    name: 'compute',
    color: 'purple1',
    description:
      'The question tests the writing and running of a piece of code to compute the answer. The answer itself is not the code, but could be a numeric answer output by the code, for example (use `code` when the answer is the code).',
  },
  {
    name: 'software',
    color: 'orange1',
    description: 'The question tests the use of a specific piece of software (e.g., Matlab).',
  },
  {
    name: 'estimation',
    color: 'red2',
    description:
      'Answering the question correctly will require some amount of estimation, so an exact answer is not possible.',
  },
  {
    name: 'secret',
    color: 'red3',
    description:
      "Only use this question on exams or quizzes that won't be released to students, so the question can be kept secret.",
  },
  {
    name: 'nontest',
    color: 'green3',
    description:
      'This question is not appropriate for use in a restricted testing environment, so only use it on homeworks or similar.',
  },
  { name: 'Sp15', color: 'gray1' },
  { name: 'Su15', color: 'gray1' },
  { name: 'Fa15', color: 'gray1' },
  { name: 'Sp16', color: 'gray1' },
  { name: 'Su16', color: 'gray1' },
  { name: 'Fa16', color: 'gray1' },
  { name: 'Sp17', color: 'gray1' },
  { name: 'Su17', color: 'gray1' },
  { name: 'Fa17', color: 'gray1' },
  { name: 'Sp18', color: 'gray1' },
  { name: 'Su18', color: 'gray1' },
  { name: 'Fa18', color: 'gray1' },
  { name: 'Sp19', color: 'gray1' },
  { name: 'Su19', color: 'gray1' },
  { name: 'Fa19', color: 'gray1' },
  { name: 'Sp20', color: 'gray1' },
  { name: 'Su20', color: 'gray1' },
  { name: 'Fa20', color: 'gray1' },
  { name: 'Sp21', color: 'gray1' },
  { name: 'Su21', color: 'gray1' },
  { name: 'Fa21', color: 'gray1' },
];

// For testing if a string is a v4 UUID
const UUID_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
// For finding all v4 UUIDs in a string/file
const FILE_UUID_REGEX =
  /"uuid":\s*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/g;

/**
 * @template T
 * @typedef {import('./infofile').InfoFile<T>} InfoFile<T>
 */

/**
 * @typedef {Object} CourseOptions
 * @property {boolean} useNewQuestionRenderer
 */

/**
 * @typedef {Object} Tag
 * @property {string} name
 * @property {string} color
 * @property {string} [description]
 */

/**
 * @typedef {Object} Topic
 * @property {string} name
 * @property {string} color
 * @property {string} description
 */

/**
 * @typedef {Object} AssessmentSet
 * @property {string} abbreviation
 * @property {string} name
 * @property {string} heading
 * @property {string} color
 */

/**
 * @typedef AssessmentModule
 * @property {string} name
 * @property {string} heading
 */

/**
 * @typedef {Object} Course
 * @property {string} uuid
 * @property {string} name
 * @property {string} title
 * @property {string} path
 * @property {string} timezone
 * @property {boolean} exampleCourse
 * @property {CourseOptions} options
 * @property {Tag[]} tags
 * @property {Topic[]} topics
 * @property {AssessmentSet[]} assessmentSets
 * @property {AssessmentModule[]} assessmentModules
 */

/** @typedef {"Student" | "TA" | "Instructor" | "Superuser"} UserRole */
/** @typedef {"UIUC" | "ZJUI" | "LTI" | "Any"} Institution */

/**
 * @typedef {Object} CourseInstanceAllowAccess
 * @property {UserRole} role
 * @property {string[]} uids
 * @property {string} startDate
 * @property {string} endDate
 * @property {Institution} institution
 */

/**
 * @typedef {Object} CourseInstance
 * @property {string} uuid
 * @property {string} longName
 * @property {number} number
 * @property {string} timezone
 * @property {boolean} hideInEnrollPage
 * @property {{ [uid: string]: "Student" | "TA" | "Instructor"}} userRoles
 * @property {CourseInstanceAllowAccess[]} allowAccess
 * @property {boolean} allowIssueReporting
 * @property {"Set" | "Module"} groupAssessmentsBy
 */

/**
 * @typedef {Object} SEBConfig
 * @property {string} password
 * @property {string} quitPassword
 * @property {string[]} allowPrograms
 */

/**
 * @typedef {Object} AssessmentAllowAccess
 * @property {"Public" | "Exam" | "SEB"} mode
 * @property {string} examUuid
 * @property {"Student" | "TA" | "Instructor"} role
 * @property {string[]} uids
 * @property {number} credit
 * @property {string} startDate
 * @property {string} endDate
 * @property {boolean} active
 * @property {number} timeLimitMin
 * @property {string} password
 * @property {SEBConfig} SEBConfig
 */

/**
 * @typedef {Object} QuestionAlternative
 * @property {number | number[]} points
 * @property {number | number[]} autoPoints
 * @property {number} maxPoints
 * @property {number} manualPoints
 * @property {number} maxAutoPoints
 * @property {string} id
 * @property {boolean} forceMaxPoints
 * @property {number} triesPerVariant
 * @property {number} advanceScorePerc
 * @property {number} gradeRateMinutes
 * @property {string[]} canView
 * @property {string[]} canSubmit
 */

/**
 * @typedef {Object} ZoneQuestion
 * @property {number | number[]} points
 * @property {number | number[]} autoPoints
 * @property {number} maxPoints
 * @property {number} manualPoints
 * @property {number} maxAutoPoints
 * @property {string} [id]
 * @property {boolean} forceMaxPoints
 * @property {QuestionAlternative[]} [alternatives]
 * @property {number} numberChoose
 * @property {number} triesPerVariant
 * @property {number} advanceScorePerc
 * @property {number} gradeRateMinutes
 * @property {string[]} canView
 * @property {string[]} canSubmit
 */

/**
 * @typedef {Object} Zone
 * @property {string} title
 * @property {number} maxPoints
 * @property {number} numberChoose
 * @property {number} bestQuestions
 * @property {ZoneQuestion[]} questions
 * @property {number} advanceScorePerc
 * @property {number} gradeRateMinutes
 * @property {string[]} canView
 * @property {string[]} canSubmit
 */

/**
 * @typedef {Object} GroupRole
 * @property {string} name
 * @property {number} minimum
 * @property {number} maximum
 * @property {boolean} canAssignRolesAtStart
 * @property {boolean} canAssignRolesDuringAssessment
 */

/**
 * @typedef {Object} Assessment
 * @property {string} uuid
 * @property {"Homework" | "Exam"} type
 * @property {string} title
 * @property {string} set
 * @property {string} module
 * @property {string} number
 * @property {boolean} allowIssueReporting
 * @property {boolean} allowRealTimeGrading
 * @property {boolean} multipleInstance
 * @property {boolean} shuffleQuestions
 * @property {AssessmentAllowAccess[]} allowAccess
 * @property {string} text
 * @property {number} maxBonusPoints
 * @property {number} maxPoints
 * @property {boolean} autoClose
 * @property {Zone[]} zones
 * @property {boolean} constantQuestionValue
 * @property {boolean} groupWork
 * @property {number} groupMaxSize
 * @property {number} groupMinSize
 * @property {boolean} studentGroupCreate
 * @property {boolean} studentGroupJoin
 * @property {boolean} studentGroupLeave
 * @property {GroupRole[]} groupRoles
 * @property {string[]} canView
 * @property {string[]} canSubmit
 * @property {number} advanceScorePerc
 * @property {number} gradeRateMinutes
 */

/**
 * @typedef {Object} QuestionExternalGradingOptions
 * @property {boolean} enabled
 * @property {string} image
 * @property {string} entrypoint
 * @property {string[]} serverFilesCourse
 * @property {number} timeout
 * @property {boolean} enableNetworking
 * @property {Record<string, string | null>} environment
 */

/**
 * @typedef {Object} QuestionWorkspaceOptions
 * @property {string} image
 * @property {number} port
 * @property {string} home
 * @property {string} args
 * @property {string[]} gradedFiles
 * @property {string} rewriteUrl
 * @property {boolean} enableNetworking
 * @property {Record<string, string | null>} environment
 */

/**
 * @typedef {Object} Question
 * @property {any} id
 * @property {string} qid
 * @property {string} uuid
 * @property {"Calculation" | "ShortAnswer" | "MultipleChoice" | "Checkbox" | "File" | "MultipleTrueFalse" | "v3"} type
 * @property {string} title
 * @property {string} topic
 * @property {string[]} tags
 * @property {string[]} clientFiles
 * @property {string[]} clientTemplates
 * @property {string} template
 * @property {"Internal" | "External" | "Manual"} gradingMethod
 * @property {boolean} singleVariant
 * @property {boolean} showCorrectAnswer
 * @property {boolean} partialCredit
 * @property {Object} options
 * @property {QuestionExternalGradingOptions} externalGradingOptions
 * @property {QuestionWorkspaceOptions} [workspaceOptions]
 * @property {Object} dependencies
 */

/**
 * @typedef {object} CourseInstanceData
 * @property {InfoFile<CourseInstance>} courseInstance
 * @property {{ [tid: string]: InfoFile<Assessment> }} assessments
 */

/**
 * @typedef {object} CourseData
 * @property {InfoFile<Course>} course
 * @property {{ [qid: string]: InfoFile<Question> }} questions
 * @property {{ [ciid: string]: CourseInstanceData }} courseInstances
 */

/**
 * @param {string} courseDir
 * @returns {Promise<CourseData>}
 */
module.exports.loadFullCourse = async function (courseDir) {
  const courseInfo = await module.exports.loadCourseInfo(courseDir);
  perf.start('loadQuestions');
  const questions = await module.exports.loadQuestions(courseDir);
  perf.end('loadQuestions');
  const courseInstanceInfos = await module.exports.loadCourseInstances(courseDir);
  const courseInstances = /** @type {{ [ciid: string]: CourseInstanceData }} */ ({});
  for (const courseInstanceId in courseInstanceInfos) {
    // TODO: is it really necessary to do all the crazy error checking on `lstat` for the assessments dir?
    // If so, duplicate all that here
    const assessments = await module.exports.loadAssessments(
      courseDir,
      courseInstanceId,
      questions,
    );
    const courseInstance = {
      courseInstance: courseInstanceInfos[courseInstanceId],
      assessments,
    };
    courseInstances[courseInstanceId] = courseInstance;
  }
  return {
    course: courseInfo,
    questions,
    courseInstances,
  };
};

/**
 * @template T
 * @param {any} courseId
 * @param {string} filePath
 * @param {InfoFile<T>} infoFile
 * @param {(line?: string) => void} writeLine
 */
function writeErrorsAndWarningsForInfoFileIfNeeded(courseId, filePath, infoFile, writeLine) {
  if (!infofile.hasErrorsOrWarnings(infoFile)) return;
  // TODO: if https://github.com/drudru/ansi_up/issues/58 is ever resolved,
  // add a direct link to a file editor with `terminal-link` package
  // const editorLink = `/pl/course/${courseId}/file_edit/${filePath}`;
  writeLine(chalk.bold(`• ${filePath}`));
  if (infofile.hasErrors(infoFile)) {
    infoFile.errors.forEach((error) => {
      const indentedError = error.replace(/\n/g, '\n    ');
      writeLine(chalk.red(`  ✖ ${indentedError}`));
    });
  }
  if (infofile.hasWarnings(infoFile)) {
    infoFile.warnings.forEach((warning) => {
      const indentedWarning = warning.replace(/\n/g, '\n    ');
      writeLine(chalk.yellow(`  ⚠ ${indentedWarning}`));
    });
  }
}

/**
 * @param {any} courseId
 * @param {CourseData} courseData
 * @param {(line?: string) => void} writeLine
 */
module.exports.writeErrorsAndWarningsForCourseData = function (courseId, courseData, writeLine) {
  writeErrorsAndWarningsForInfoFileIfNeeded(
    courseId,
    'infoCourse.json',
    courseData.course,
    writeLine,
  );
  Object.entries(courseData.questions).forEach(([qid, question]) => {
    const questionPath = path.posix.join('questions', qid, 'info.json');
    writeErrorsAndWarningsForInfoFileIfNeeded(courseId, questionPath, question, writeLine);
  });
  Object.entries(courseData.courseInstances).forEach(([ciid, courseInstanceData]) => {
    const courseInstancePath = path.posix.join('courseInstances', ciid, 'infoCourseInstance.json');
    writeErrorsAndWarningsForInfoFileIfNeeded(
      courseId,
      courseInstancePath,
      courseInstanceData.courseInstance,
      writeLine,
    );
    Object.entries(courseInstanceData.assessments).forEach(([aid, assessment]) => {
      const assessmentPath = path.posix.join(
        'courseInstances',
        ciid,
        'assessments',
        aid,
        'infoAssessment.json',
      );
      writeErrorsAndWarningsForInfoFileIfNeeded(courseId, assessmentPath, assessment, writeLine);
    });
  });
};

/**
 * @param {CourseData} courseData
 * @returns {boolean}
 */
module.exports.courseDataHasErrors = function (courseData) {
  if (infofile.hasErrors(courseData.course)) return true;
  if (Object.values(courseData.questions).some(infofile.hasErrors)) return true;
  if (
    Object.values(courseData.courseInstances).some((courseInstance) => {
      if (infofile.hasErrors(courseInstance.courseInstance)) return true;
      return Object.values(courseInstance.assessments).some(infofile.hasErrors);
    })
  ) {
    return true;
  }
  return false;
};

/**
 * @param {CourseData} courseData
 * @returns {boolean}
 */
module.exports.courseDataHasErrorsOrWarnings = function (courseData) {
  if (infofile.hasErrorsOrWarnings(courseData.course)) return true;
  if (Object.values(courseData.questions).some(infofile.hasErrorsOrWarnings)) return true;
  if (
    Object.values(courseData.courseInstances).some((courseInstance) => {
      if (infofile.hasErrorsOrWarnings(courseInstance.courseInstance)) return true;
      return Object.values(courseInstance.assessments).some(infofile.hasErrorsOrWarnings);
    })
  ) {
    return true;
  }
  return false;
};

/**
 * Loads a JSON file at the path `path.join(coursePath, filePath). The
 * path is passed as two separate paths so that we can avoid leaking the
 * absolute path on disk to users.
 * @template {{ uuid: string }} T
 * @param {Object} options - Options for loading and validating the file
 * @param {string} options.coursePath
 * @param {string} options.filePath
 * @param {object} [options.schema]
 * @param {boolean} [options.tolerateMissing] - Whether or not a missing file constitutes an error
 * @returns {Promise<InfoFile<T> | null>}
 */
module.exports.loadInfoFile = async function ({
  coursePath,
  filePath,
  schema,
  tolerateMissing = false,
}) {
  const absolutePath = path.join(coursePath, filePath);
  let contents;
  try {
    // perf.start(`readfile:${absolutePath}`);
    // fs-extra uses graceful-fs, which in turn will enqueue open operations.
    // this slows us down an unnecessary amount. Avoiding this queueing means
    // we could potentially hit an EMFILE error, but we haven't seen that in
    // practice in years, so that's a risk we're willing to take. We explicitly
    // use the native Node fs API here to opt out of this queueing behavior.
    contents = await fs.readFile(absolutePath, 'utf8');
    // perf.end(`readfile:${absolutePath}`);
  } catch (err) {
    // perf.end(`readfile:${absolutePath}`);
    if (err.code === 'ENOTDIR' && err.path === absolutePath) {
      // In a previous version of this code, we'd pre-filter
      // all files in the parent directory to remove anything
      // that may have accidentally slipped in, like .DS_Store.
      // However, that resulted in a huge number of system calls
      // that got really slow for large directories. Now, we'll
      // just blindly try to read a file from the directory and assume
      // that if we see ENOTDIR, that means the directory was not
      // in fact a directory.
      return null;
    }
    if (tolerateMissing && err.code === 'ENOENT' && err.path === absolutePath) {
      // For info files that are recursively loaded, this probably means
      // we tried to load a file at an intermediate directory. This isn't
      // an error; return null to let the caller handle this.
      return null;
    }

    // If it wasn't a missing file, this is another error. Propagate it to
    // the caller.
    return infofile.makeError(`Error reading JSON file ${filePath}: ${err.code}`);
  }

  try {
    // jju is about 5x slower than standard JSON.parse. In the average
    // case, we'll have valid JSON, so we can take the fast path. If we
    // fail to parse, we'll take the hit and reparse with jju to generate
    // a better error report for users.
    const json = JSON.parse(contents);
    if (!json.uuid) {
      return infofile.makeError('UUID is missing');
    }
    if (!UUID_REGEX.test(json.uuid)) {
      return infofile.makeError(`UUID "${json.uuid}" is not a valid v4 UUID`);
    }

    if (!schema) {
      // Skip schema validation, just return the data
      return infofile.makeInfoFile({
        uuid: json.uuid,
        data: json,
      });
    }

    // Validate file against schema
    const validate = /** @type {import('ajv').ValidateFunction<T>} */ (ajv.compile(schema));
    try {
      validate(json);
      if (validate.errors) {
        const result = infofile.makeInfoFile({ uuid: /** @type {any} */ (json).uuid });
        const errorText = betterAjvErrors(schema, json, validate.errors, {
          indent: 2,
        });
        const errorTextString = String(errorText); // hack to fix incorrect type in better-ajv-errors/typings.d.ts
        infofile.addError(result, errorTextString);
        return result;
      }
      return infofile.makeInfoFile({
        uuid: json.uuid,
        data: json,
      });
    } catch (err) {
      return infofile.makeError(err.message);
    }
  } catch (err) {
    // Invalid JSON; let's reparse with jju to get a better error message
    // for the user.
    /** @type {import('./infofile').InfoFile<T>} */
    let result = {};
    try {
      // This should always throw
      jju.parse(contents, { mode: 'json' });
    } catch (e) {
      result = infofile.makeError(`Error parsing JSON: ${e.message}`);
    }

    // The document was still valid JSON, but we may still be able to
    // extract a UUID from the raw files contents with a regex.
    const match = (contents || '').match(FILE_UUID_REGEX);
    if (!match) {
      infofile.addError(result, 'UUID not found in file');
      return result;
    }
    if (match.length > 1) {
      infofile.addError(result, 'More than one UUID found in file');
      return result;
    }

    // Extract and store UUID. Checking for a falsy value isn't technically
    // required, but it keeps TypeScript happy.
    const uuid = match[0].match(UUID_REGEX);
    if (!uuid) {
      infofile.addError(result, 'UUID not found in file');
      return result;
    }

    result.uuid = uuid[0];
    return result;
  }
};

/**
 * @param {string} coursePath
 * @returns {Promise<InfoFile<Course>>}
 */
module.exports.loadCourseInfo = async function (coursePath) {
  /** @type {import('./infofile').InfoFile<Course> | null} */
  const maybeNullLoadedData = await module.exports.loadInfoFile({
    coursePath,
    filePath: 'infoCourse.json',
    schema: schemas.infoCourse,
  });

  if (maybeNullLoadedData && infofile.hasErrors(maybeNullLoadedData)) {
    // We'll only have an error if we couldn't parse JSON data; abort
    return maybeNullLoadedData;
  }

  if (!maybeNullLoadedData || !maybeNullLoadedData.data) {
    throw new Error('Could not load infoCourse.json');
  }

  // Reassign to a non-null type.
  const loadedData = maybeNullLoadedData;
  const info = maybeNullLoadedData.data;

  /**
   * Used to retrieve fields such as "assessmentSets" and "topics".
   * Adds a warning when syncing if duplicates are found.
   * If defaults are provided, the entries from defaults not present in the resulting list are merged.
   * @template {'tags' | 'topics' | 'assessmentSets' | 'assessmentModules'} K
   * @template T
   * @param {K} fieldName The member of `info` to inspect
   * @param {string} entryIdentifier The member of each element of the field which uniquely identifies it, usually "name"
   * @param {Course[K]} [defaults]
   * @returns {Course[K]}
   */
  function getFieldWithoutDuplicates(fieldName, entryIdentifier, defaults) {
    const known = new Map();
    const duplicateEntryIds = new Set();

    (info[fieldName] || []).forEach((entry) => {
      const entryId = entry[entryIdentifier];
      if (known.has(entryId)) {
        duplicateEntryIds.add(entryId);
      }
      known.set(entryId, entry);
    });

    if (duplicateEntryIds.size > 0) {
      const duplicateIdsString = [...duplicateEntryIds.values()]
        .map((name) => `"${name}"`)
        .join(', ');
      const warning = `Found duplicates in '${fieldName}': ${duplicateIdsString}. Only the last of each duplicate will be synced.`;
      infofile.addWarning(loadedData, warning);
    }

    if (defaults) {
      defaults.forEach((defaultEntry) => {
        const defaultEntryId = defaultEntry[entryIdentifier];
        if (!known.has(defaultEntryId)) {
          known.set(defaultEntryId, defaultEntry);
        }
      });
    }

    // Turn the map back into a list; the JS spec ensures that Maps remember
    // insertion order, so the order is preserved.
    return [...known.values()];
  }

  const assessmentSets = getFieldWithoutDuplicates(
    'assessmentSets',
    'name',
    DEFAULT_ASSESSMENT_SETS,
  );
  const tags = getFieldWithoutDuplicates('tags', 'name', DEFAULT_TAGS);
  const topics = getFieldWithoutDuplicates('topics', 'name');
  const assessmentModules = getFieldWithoutDuplicates('assessmentModules', 'name');

  const exampleCourse =
    info.uuid === 'fcc5282c-a752-4146-9bd6-ee19aac53fc5' &&
    info.title === 'Example Course' &&
    info.name === 'XC 101';

  const course = {
    uuid: info.uuid.toLowerCase(),
    path: coursePath,
    name: info.name,
    title: info.title,
    timezone: info.timezone,
    assessmentSets,
    assessmentModules,
    tags,
    topics,
    exampleCourse,
    options: {
      useNewQuestionRenderer: _.get(info, 'options.useNewQuestionRenderer', false),
    },
  };

  loadedData.data = course;
  return loadedData;
};

/**
 * @template {{ uuid: string }} T
 * @param {Object} options - Options for loading and validating the file
 * @param {string} options.coursePath
 * @param {string} options.filePath
 * @param {any} options.defaults
 * @param {any} options.schema
 * @param {boolean} [options.tolerateMissing] - Whether or not a missing file constitutes an error
 * @param {(info: T) => Promise<{ warnings: string[], errors: string[] }>} options.validate
 * @returns {Promise<InfoFile<T> | null>}
 */
async function loadAndValidateJson({
  coursePath,
  filePath,
  defaults,
  schema,
  validate,
  tolerateMissing,
}) {
  const loadedJson = /** @type {InfoFile<T>} */ (
    await module.exports.loadInfoFile({
      coursePath,
      filePath,
      schema,
      tolerateMissing,
    })
  );
  if (loadedJson === null) {
    // This should only occur if we looked for a file in a non-directory,
    // as would happen if there was a .DS_Store file, or if we're
    // tolerating missing files, as we'd need to for nesting support.
    return null;
  }
  if (infofile.hasErrors(loadedJson) || !loadedJson.data) {
    return loadedJson;
  }

  const validationResult = await validate(loadedJson.data);
  if (validationResult.errors.length > 0) {
    infofile.addErrors(loadedJson, validationResult.errors);
    return loadedJson;
  }

  loadedJson.data = _.defaults(loadedJson.data, defaults);
  infofile.addWarnings(loadedJson, validationResult.warnings);
  return loadedJson;
}

/**
 * Loads and schema-validates all info files in a directory.
 * @template {{ uuid: string }} T
 * @param {Object} options - Options for loading and validating files
 * @param {string} options.coursePath The path of the course being synced
 * @param {string} options.directory The path of the directory relative to `coursePath`
 * @param {string} options.infoFilename
 * @param {any} options.defaultInfo
 * @param {object} options.schema
 * @param {boolean} [options.recursive] - Whether or not info files should be searched for recursively
 * @param {(info: T) => Promise<{ warnings: string[], errors: string[] }>} options.validate
 * @returns {Promise<{ [id: string]: InfoFile<T> }>}
 */
async function loadInfoForDirectory({
  coursePath,
  directory,
  infoFilename,
  defaultInfo,
  schema,
  validate,
  recursive = false,
}) {
  // Recursive lookup might not be enabled for some info types - if it's
  // disabled, we'll still utilize the same recursive function, but the
  // recursive function won't actually recurse.
  const infoFilesRootDir = path.join(coursePath, directory);
  const walk = async (relativeDir) => {
    const infoFiles = /** @type {{ [id: string]: InfoFile<T> }} */ ({});
    const files = await fs.readdir(path.join(infoFilesRootDir, relativeDir));

    // For each file in the directory, assume it is a question directory
    // and attempt to access `info.json`. If we can successfully read it,
    // hooray, we're done.
    await async.each(files, async (/** @type {string} */ dir) => {
      const infoFilePath = path.join(directory, relativeDir, dir, infoFilename);
      const info = /** @type {InfoFile<T>} */ (
        await loadAndValidateJson({
          coursePath,
          filePath: infoFilePath,
          defaults: defaultInfo,
          schema,
          validate,
          // If we aren't operating in recursive mode, we want to ensure
          // that missing files are correctly reflected as errors.
          tolerateMissing: recursive,
        })
      );
      if (info) {
        infoFiles[path.join(relativeDir, dir)] = info;
      } else if (recursive) {
        try {
          const subInfoFiles = await walk(path.join(relativeDir, dir));
          if (_.isEmpty(subInfoFiles)) {
            infoFiles[path.join(relativeDir, dir)] = infofile.makeError(
              `Missing JSON file: ${infoFilePath}`,
            );
          }
          _.assign(infoFiles, subInfoFiles);
        } catch (e) {
          if (e.code === 'ENOTDIR') {
            // This wasn't a directory; ignore it.
          } else if (e.code === 'ENOENT') {
            // Missing directory; record it
            infoFiles[path.join(relativeDir, dir)] = infofile.makeError(
              `Missing JSON file: ${infoFilePath}`,
            );
          } else {
            // Some other error, permissions perhaps. Throw to abort sync.
            throw e;
          }
        }
      }
    });
    return infoFiles;
  };

  try {
    return await walk('');
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Missing directory; return an empty list
      return /** @type {{ [id: string]: InfoFile<T> }} */ ({});
    }
    // Some other error; Throw it to abort.
    throw e;
  }
}

/**
 * @template T
 * @param {{ [id: string]: InfoFile<T>}} infos
 * @param {(uuid: string, otherIds: string[]) => string} makeErrorMessage
 */
function checkDuplicateUUIDs(infos, makeErrorMessage) {
  // First, create a map from UUIDs to questions that use them
  const uuids = Object.entries(infos).reduce((map, [id, info]) => {
    if (!info.uuid) {
      // Couldn't find UUID in the file
      return map;
    }
    let ids = map.get(info.uuid);
    if (!ids) {
      ids = [];
      map.set(info.uuid, ids);
    }
    ids.push(id);
    return map;
  }, /** @type {Map<string, string[]>} */ (new Map()));

  // Do a second pass to add errors for things with duplicate IDs
  // We also null out UUIDs for items where duplicates are found
  uuids.forEach((ids, uuid) => {
    if (ids.length === 1) {
      // Only one question uses this UUID
      return;
    }
    ids.forEach((id) => {
      const otherIds = ids.filter((other) => other !== id);
      infofile.addWarning(infos[id], makeErrorMessage(uuid, otherIds));
      infos[id].uuid = undefined;
    });
  });
}

/**
 * Checks that roles are not present.
 * @param {{ role?: UserRole }} rule
 * @returns {string[]} A list of warnings, if any
 */
function checkAllowAccessRoles(rule) {
  const warnings = [];
  if ('role' in rule) {
    if (rule.role !== 'Student') {
      warnings.push(
        `The entire "allowAccess" rule with "role: ${rule.role}" should be deleted. Instead, course owners can now manage course staff access on the "Staff" page.`,
      );
    }
  }
  return warnings;
}

/**
 * Checks that dates, if present, are valid and sequenced correctly.
 * @param {{ startDate?: string, endDate?: string }} rule
 * @returns {{errors: string[], dateInFuture: boolean}} A list of errors, if any, and whether there are any dates in the future
 */
function checkAllowAccessDates(rule) {
  const errors = [];
  let startDate, endDate;
  if (rule.startDate) {
    startDate = parseISO(rule.startDate);
    if (!isValid(startDate)) {
      startDate = null;
      errors.push(`Invalid allowAccess rule: startDate (${rule.startDate}) is not valid`);
    }
  }
  if (rule.endDate) {
    endDate = parseISO(rule.endDate);
    if (!isValid(endDate)) {
      endDate = null;
      errors.push(`Invalid allowAccess rule: endDate (${rule.endDate}) is not valid`);
    }
  }
  if (startDate && endDate && isAfter(startDate, endDate)) {
    errors.push(
      `Invalid allowAccess rule: startDate (${rule.startDate}) must not be after endDate (${rule.endDate})`,
    );
  }
  let dateInFuture = false;
  if (startDate && isFuture(startDate)) {
    dateInFuture = true;
  }
  if (endDate && isFuture(endDate)) {
    dateInFuture = true;
  }
  return { errors, dateInFuture };
}

/**
 * @param {Question} question
 * @returns {Promise<{ warnings: string[], errors: string[] }>}
 */
async function validateQuestion(question) {
  const warnings = [];
  const errors = [];

  if (question.type && question.options) {
    try {
      const schema = schemas[`questionOptions${question.type}`];
      const options = question.options;
      jsonLoad.validateJSON(options, schema);
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (question.externalGradingOptions?.timeout) {
    if (question.externalGradingOptions.timeout > config.externalGradingMaximumTimeout) {
      question.externalGradingOptions.timeout = config.externalGradingMaximumTimeout;
      warnings.push(
        `External grading timeout value of ${question.externalGradingOptions.timeout} seconds exceeds the maximum value and has been limited to ${config.externalGradingMaximumTimeout} seconds.`,
      );
    }
  }

  return { warnings, errors };
}

/**
 * @param {Assessment} assessment
 * @param {{ [qid: string]: any }} questions
 * @returns {Promise<{ warnings: string[], errors: string[] }>}
 */
async function validateAssessment(assessment, questions) {
  const warnings = [];
  const errors = [];

  const allowRealTimeGrading = _.get(assessment, 'allowRealTimeGrading', true);
  if (assessment.type === 'Homework') {
    // Because of how Homework-type assessments work, we don't allow
    // real-time grading to be disabled for them.
    if (!allowRealTimeGrading) {
      errors.push(`Real-time grading cannot be disabled for Homework-type assessments`);
    }

    // Homework-type assessments with multiple instances are not supported
    if (assessment.multipleInstance) {
      errors.push(`"multipleInstance" cannot be used for Homework-type assessments`);
    }
  }

  // Check assessment access rules
  let anyDateInFuture = false;
  (assessment.allowAccess || []).forEach((rule) => {
    const allowAccessResult = checkAllowAccessDates(rule);
    if (allowAccessResult.dateInFuture) {
      anyDateInFuture = true;
    }

    if ('active' in rule && rule.active === false && 'credit' in rule && rule.credit !== 0) {
      errors.push(`Invalid allowAccess rule: credit must be 0 if active is false`);
    }

    errors.push(...allowAccessResult.errors);
  });

  if (anyDateInFuture) {
    // only warn about new roles for current or future courses
    (assessment.allowAccess || []).forEach((rule) => {
      const allowAccessWarnings = checkAllowAccessRoles(rule);
      warnings.push(...allowAccessWarnings);
    });
  }

  const foundQids = new Set();
  const duplicateQids = new Set();
  const missingQids = new Set();
  /** @type {(qid: string) => void} */
  const checkAndRecordQid = (qid) => {
    if (qid[0] === '@') {
      // Question is being imported from another course. We hold off on validating this until
      // sync time because we need to query the database to verify that the question exists
      return;
    }
    if (!(qid in questions)) {
      missingQids.add(qid);
    }
    if (!foundQids.has(qid)) {
      foundQids.add(qid);
    } else {
      duplicateQids.add(qid);
    }
  };
  (assessment.zones || []).forEach((zone) => {
    (zone.questions || []).map((zoneQuestion) => {
      /** @type {number | number[]} */
      const autoPoints = zoneQuestion.autoPoints ?? zoneQuestion.points;
      if (!allowRealTimeGrading && Array.isArray(autoPoints) && autoPoints.length > 1) {
        errors.push(
          `Cannot specify an array of multiple point values for a question if real-time grading is disabled`,
        );
      }
      // We'll normalize either single questions or alternative groups
      // to make validation easier
      /** @type {{ points: number | number[], autoPoints: number | number[], maxPoints: number, maxAutoPoints: number, manualPoints: number }[]} */
      let alternatives = [];
      if ('alternatives' in zoneQuestion && 'id' in zoneQuestion) {
        errors.push('Cannot specify both "alternatives" and "id" in one question');
      } else if (zoneQuestion?.alternatives) {
        zoneQuestion.alternatives.forEach((alternative) => checkAndRecordQid(alternative.id));
        alternatives = zoneQuestion.alternatives.map((alternative) => {
          /** @type {number | number[]} */
          const autoPoints = alternative.autoPoints ?? alternative.points;
          if (!allowRealTimeGrading && Array.isArray(autoPoints) && autoPoints.length > 1) {
            errors.push(
              `Cannot specify an array of multiple point values for an alternative if real-time grading is disabled`,
            );
          }
          return {
            points: alternative.points ?? zoneQuestion.points,
            maxPoints: alternative.maxPoints ?? zoneQuestion.maxPoints,
            maxAutoPoints: alternative.maxAutoPoints ?? zoneQuestion.maxAutoPoints,
            autoPoints: alternative.autoPoints ?? zoneQuestion.autoPoints,
            manualPoints: alternative.manualPoints ?? zoneQuestion.manualPoints,
          };
        });
      } else if (zoneQuestion.id) {
        checkAndRecordQid(zoneQuestion.id);
        alternatives = [
          {
            points: zoneQuestion.points,
            maxPoints: zoneQuestion.maxPoints,
            maxAutoPoints: zoneQuestion.maxAutoPoints,
            autoPoints: zoneQuestion.autoPoints,
            manualPoints: zoneQuestion.manualPoints,
          },
        ];
      } else {
        errors.push(`Zone question must specify either "alternatives" or "id"`);
      }

      alternatives.forEach((alternative) => {
        if (
          alternative.points === undefined &&
          alternative.autoPoints === undefined &&
          alternative.manualPoints === undefined
        ) {
          errors.push('Must specify "points", "autoPoints" or "manualPoints" for a question');
        }
        if (
          alternative.points !== undefined &&
          (alternative.autoPoints !== undefined ||
            alternative.manualPoints !== undefined ||
            alternative.maxAutoPoints !== undefined)
        ) {
          errors.push(
            'Cannot specify "points" for a question if "autoPoints", "manualPoints" or "maxAutoPoints" are specified',
          );
        }
        if (assessment.type === 'Exam') {
          if (alternative.maxPoints !== undefined || alternative.maxAutoPoints !== undefined) {
            errors.push(
              'Cannot specify "maxPoints" or "maxAutoPoints" for a question in an "Exam" assessment',
            );
          }

          const hasSplitPoints =
            alternative.autoPoints !== undefined ||
            alternative.maxAutoPoints !== undefined ||
            alternative.manualPoints !== undefined;
          const autoPoints = (hasSplitPoints ? alternative.autoPoints : alternative.points) ?? 0;
          const pointsList = Array.isArray(autoPoints) ? autoPoints : [autoPoints];
          const isNonIncreasing = pointsList.every(
            (points, index) => index === 0 || points <= pointsList[index - 1],
          );
          if (!isNonIncreasing) {
            errors.push('Points for a question must be non-increasing');
          }
        }
        if (assessment.type === 'Homework') {
          if (
            alternative.maxPoints !== undefined &&
            (alternative.autoPoints !== undefined ||
              alternative.manualPoints !== undefined ||
              alternative.maxAutoPoints !== undefined)
          ) {
            errors.push(
              'Cannot specify "maxPoints" for a question if "autoPoints", "manualPoints" or "maxAutoPoints" are specified',
            );
          }
          if (Array.isArray(alternative.autoPoints ?? alternative.points)) {
            errors.push(
              'Cannot specify "points" or "autoPoints" as a list for a question in a "Homework" assessment',
            );
          }
        }
      });
    });
  });

  if (duplicateQids.size > 0) {
    errors.push(
      `The following questions are used more than once: ${[...duplicateQids].join(', ')}`,
    );
  }

  if (missingQids.size > 0) {
    errors.push(
      `The following questions do not exist in this course: ${[...missingQids].join(', ')}`,
    );
  }

  if (assessment.groupRoles) {
    // Ensure at least one role can assign roles before and during an assessment
    let foundCanAssignRolesAtStart = false;
    let foundCanAssignRolesDuringAssessment = false;

    assessment.groupRoles.forEach((role) => {
      if (role.canAssignRolesAtStart && role.minimum >= 1) {
        foundCanAssignRolesAtStart = true;
      }
      if (role.canAssignRolesDuringAssessment && role.minimum >= 1) {
        foundCanAssignRolesDuringAssessment = true;
      }
    });

    if (!foundCanAssignRolesAtStart) {
      errors.push(
        'Could not find a role with minimum >= 1 and "can_assign_roles_at_start" set to "true".',
      );
    }
    if (!foundCanAssignRolesDuringAssessment) {
      errors.push(
        'Could not find a role with minimum >= 1 and "can_assign_roles_during_assessment" set to "true".',
      );
    }

    // Ensure values for role minimum and maximum are within bounds
    assessment.groupRoles.forEach((role) => {
      if (role.minimum > assessment.groupMinSize) {
        warnings.push(
          `Group role "${role.name}" has a minimum greater than the group's minimum size.`,
        );
      }
      if (role.minimum && role.minimum > assessment.groupMaxSize) {
        errors.push(
          `Group role "${role.name}" contains an invalid minimum. (Expected at most ${assessment.groupMaxSize}, found ${role.minimum}).`,
        );
      }
      if (role.maximum && role.maximum > assessment.groupMaxSize) {
        errors.push(
          `Group role "${role.name}" contains an invalid maximum. (Expected at most ${assessment.groupMaxSize}, found ${role.maximum}).`,
        );
      }
      if (role.minimum > role.maximum) {
        errors.push(
          `Group role "${role.name}" must have a minimum <= maximum. (Expected minimum <= ${role.maximum}, found minimum = ${role.minimum}).`,
        );
      }
    });

    const validRoleNames = new Set();
    assessment.groupRoles?.forEach((role) => {
      validRoleNames.add(role.name);
    });

    /** @type {(canView: string[], canSubmit: string[], area: string) => void} */
    const validateViewAndSubmitRolePermissions = (canView, canSubmit, area) => {
      (canView || []).forEach((roleName) => {
        if (!validRoleNames.has(roleName)) {
          errors.push(
            `The ${area}'s "canView" permission contains the non-existent group role name "${roleName}".`,
          );
        }
      });
      (canSubmit || []).forEach((roleName) => {
        if (!validRoleNames.has(roleName)) {
          errors.push(
            `The ${area}'s "canSubmit" permission contains the non-existent group role name "${roleName}".`,
          );
        }
      });
    };

    // Validate role names at the assessment level
    validateViewAndSubmitRolePermissions(assessment.canView, assessment.canSubmit, 'assessment');

    // Validate role names for each zone
    (assessment.zones || []).forEach((zone) => {
      validateViewAndSubmitRolePermissions(zone.canView, zone.canSubmit, 'zone');
      // Validate role names for each question
      (zone.questions || []).forEach((zoneQuestion) => {
        validateViewAndSubmitRolePermissions(
          zoneQuestion.canView,
          zoneQuestion.canSubmit,
          'zone question',
        );
      });
    });
  }

  return { warnings, errors };
}

/**
 * @param {CourseInstance} courseInstance
 * @returns {Promise<{ warnings: string[], errors: string[] }>}
 */
async function validateCourseInstance(courseInstance) {
  const warnings = [];
  const errors = [];

  if (_(courseInstance).has('allowIssueReporting')) {
    if (courseInstance.allowIssueReporting) {
      warnings.push('"allowIssueReporting" is no longer needed.');
    } else {
      errors.push(
        '"allowIssueReporting" is no longer permitted in "infoCourseInstance.json". Instead, set "allowIssueReporting" in "infoAssessment.json" files.',
      );
    }
  }

  let anyDateInFuture = false;
  (courseInstance.allowAccess || []).forEach((rule) => {
    const allowAccessResult = checkAllowAccessDates(rule);
    if (allowAccessResult.dateInFuture) {
      anyDateInFuture = true;
    }

    errors.push(...allowAccessResult.errors);
  });

  if (anyDateInFuture) {
    // only warn about new roles for current or future courses
    (courseInstance.allowAccess || []).forEach((rule) => {
      const allowAccessWarnings = checkAllowAccessRoles(rule);
      warnings.push(...allowAccessWarnings);
    });

    if (_(courseInstance).has('userRoles')) {
      warnings.push(
        'The property "userRoles" should be deleted. Instead, course owners can now manage staff access on the "Staff" page.',
      );
    }
  }

  return { warnings, errors };
}

/**
 * Loads all questions in a course directory.
 *
 * @param {string} coursePath
 */
module.exports.loadQuestions = async function (coursePath) {
  /** @type {{ [qid: string]: InfoFile<Question> }} */
  const questions = await loadInfoForDirectory({
    coursePath,
    directory: 'questions',
    infoFilename: 'info.json',
    defaultInfo: DEFAULT_QUESTION_INFO,
    schema: schemas.infoQuestion,
    validate: validateQuestion,
    recursive: true,
  });
  // Don't allow question directories to start with '@', because it is
  // used to import questions from other courses.
  for (let qid in questions) {
    if (qid[0] === '@') {
      infofile.addError(questions[qid], `Question IDs are not allowed to begin with '@'`);
    }
  }
  checkDuplicateUUIDs(
    questions,
    (uuid, ids) => `UUID "${uuid}" is used in other questions: ${ids.join(', ')}`,
  );
  return questions;
};

/**
 * Loads all course instances in a course directory.
 *
 * @param {string} coursePath
 */
module.exports.loadCourseInstances = async function (coursePath) {
  /** @type {{ [ciid: string]: InfoFile<CourseInstance> }} */
  const courseInstances = await loadInfoForDirectory({
    coursePath,
    directory: 'courseInstances',
    infoFilename: 'infoCourseInstance.json',
    defaultInfo: DEFAULT_COURSE_INSTANCE_INFO,
    schema: schemas.infoCourseInstance,
    validate: validateCourseInstance,
    recursive: true,
  });
  checkDuplicateUUIDs(
    courseInstances,
    (uuid, ids) => `UUID "${uuid}" is used in other course instances: ${ids.join(', ')}`,
  );
  return courseInstances;
};

/**
 * Loads all assessments in a course instance.
 *
 * @param {string} coursePath
 * @param {string} courseInstance
 * @param {{ [qid: string]: any }} questions
 */
module.exports.loadAssessments = async function (coursePath, courseInstance, questions) {
  const assessmentsPath = path.join('courseInstances', courseInstance, 'assessments');
  /** @type {(assessment: Assessment) => Promise<{ warnings: string[], errors: string[] }>} */
  const validateAssessmentWithQuestions = (assessment) => validateAssessment(assessment, questions);
  /** @type {{ [tid: string]: InfoFile<Assessment> }} */
  const assessments = await loadInfoForDirectory({
    coursePath,
    directory: assessmentsPath,
    infoFilename: 'infoAssessment.json',
    defaultInfo: DEFAULT_ASSESSMENT_INFO,
    schema: schemas.infoAssessment,
    validate: validateAssessmentWithQuestions,
    recursive: true,
  });
  checkDuplicateUUIDs(
    assessments,
    (uuid, ids) =>
      `UUID "${uuid}" is used in other assessments in this course instance: ${ids.join(', ')}`,
  );
  return assessments;
};
