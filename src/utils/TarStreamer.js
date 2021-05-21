const tar = require("tar-stream");

const toBuffer = async (files) => new Promise((resolve, reject) => {
  try {
    const pack = tar.pack() // pack is a streams2 stream
    
    for (let name in files) {
      if (typeof files[name] === "string")
        pack.entry({ name }, files[name]);
      else
        pack.entry({ name, mode: parseInt(files[name].mode, 8) }, files[name].content);
    }

    pack.finalize();
    
    // Array of buffer chunks.
    let chunks = [];

    pack.on("data", (chunk) => chunks.push(chunk));

    // concat joins chunks into one buffer.
    pack.on("end", () => resolve(Buffer.concat(chunks)));
  }
  catch (err) {
    return reject(err);
  }
});

const parseTarStream = async (tarStream) => new Promise((resolve, reject) => {
  try {
    let result = { };

    const extract = tar.extract();
  
    extract.on('entry', function(header, stream, next) {
      // header is the tar header
      // stream is the content body (might be an empty stream)
      // call next when you are done with this entry
      const { name } = header;
      result[name] = "";
  
      stream.setEncoding('utf8');
  
      // Readable streams emit 'data' events once a listener is added.
      stream.on('data', (chunk) => {
        result[name] += chunk;
      });
      
      stream.on('end', function() {
        next(); // ready for next entry
      });
    });
  
    extract.on('finish', function() {
      return resolve(result);
    });
  
    tarStream.pipe(extract);
  }
  catch (err) {
    return reject(err);
  }
});

module.exports = {
  toBuffer,
  parseTarStream
};