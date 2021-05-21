const supportedErrs = Object.values(require('./errors')).map(err => err.name);

const ErrorHandler = (err) => {
  
  let result = { 
    name: "MessageError",
    message: "Internal server error.", 
    title: "Internal server error." 
  };

  if (supportedErrs.includes(err.name)) {
    result.message = err.reason;
    result.title = err.name;
  }
  else {
    process.READY_TO_EXIT.error = true;
  }

  return result;
};

module.exports = ErrorHandler;
