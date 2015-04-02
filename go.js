// Example of things to do with the repl

// Request a list of the exposed functions on Main
// rpc.send('#list', function(err,list) { if (err) {console.error(err); return;} console.log(list) }, 'Main')
// rpc.send('sum', [2,3], function(err,result) { if (err) {console.error(err); return;} console.log('The result should be 5? '+result) }, 'a')

// Ping for latency in ms round trip time.
// rpc.ping('Other',console.log)

// Spam sending time
// setInterval( function(){ rpc.send('echo', [ 'The DateTime on '+rpc._name+' is: ' , Date(Date.now()) ]) }, 1000 )
// rpc.send('sum', [3,5], function(err,result){ console.log('Answer: '+result + ' from ' + this.doc.from ) })

var assert = require('assert')
var mongoose = require('mongoose')
var fs = require('fs')
var MongooseRPC = require('./index.js')

console.log('Usage of this program:\nnode go <Name>\nIt may be a good idea to setup a config file with a mongooseConnect: \'mongodb://yourconnectstring\'\n');

var configFile = './config.json';
var config = {
  mongooseConnect: 'mongodb://localhost/test'
}

if (fs.existsSync(configFile)) {
  configFile = JSON.parse(fs.readFileSync(configFile, 'utf8'))
}

var collection = 'testrpc'
var name = process.argv[2] || 'Main'

console.log('RPC Name is ' + name);
var rpc = new MongooseRPC(mongoose, collection, name)

/* =======================
 *  Exposing Functions
 */
  function echo() {
    console.log.apply(console, arguments)
  }

rpc.expose(echo)

rpc.expose(function sum(a, b) {
  return a + b;
})

var options = {
  db: {
    native_parser: true
  },
  server: {
    poolSize: 1,
    socketOptions: {
      keepAlive: 1
    }
  }
}

mongoose.connection.on('connected', function() {
  console.log('Database Connected')
  rpc.start()
}).on('error', function(err) {
  console.error('Mongoose default connection error: ' + err)
  rpc.stop()
}).on('disconnected', function() {
  console.log('Mongoose disconnected attempting reconnect.')
  rpc.stop()
})

function connectToServer() {
  console.log('Connecting to MongoDB')
  mongoose.connect(config.mongooseConnect, options)
}

connectToServer()

// process.on( 'SIGINT', function() {
//   console.log( "\nGracefully shutting down from SIGINT (Ctrl-C)" );
//   // some other closing procedures go here
//   console.log('Exiting Process ' + name)
//   rpc.stop()

//   process.exit( );
// })

process.on('exit', function() {
  console.log('Exiting Process ' + name)
  rpc.stop()
  process.exit(1)
});

var repl = require("repl");
repl.start({
  prompt: "rpc " + name + "> ",
  input: process.stdin,
  output: process.stdout
}).on('exit', function() {
  process.exit(0)
}).context.rpc = rpc


// Gets if in Debug Mode (I was having trouble seeing exception using dumpError in the debugger.)
// If debugger is present would rather throw exception
var debug = typeof v8debug === 'object'
if (debug) {
  console.log('Running in a debugger.')
}

// Outputs a pretty error
function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.error('\n\x1b[31;1m' + (err.name || 'Error') + ': ' + err.message + '\x1b[0m')
    }
    console.log(new Date())
    if (err.stack) {
      console.error('\x1b[31;1mStacktrace:\x1b[0m', '\n', err.stack.split('\n').splice(1).join('\n'))
    }
  } else {
    console.error('\x1b[31;1m' + err + '\x1b[0m')
  }
}

rpc.on('error', console.error)
rpc.on('warning', console.warn)

rpc.on('started', function(name) { console.log('RPC has started on '+name) } )
rpc.on('stopped', function(name) { console.log('RPC has stopped on '+name) } )
rpc.on('extension', function(where) { console.log('RPC has extended a function ',where) } )
rpc.on('pinged', function(name) { console.log('RPC has been pinged from '+name) } )

process.on('uncaughtException', function(exception) {
  dumpError(exception);
  if (rpc.isStarted()) {
    rpc.restart() // Resume the RPC because sometimes the tailable cursor stops working.
  }
});

global.rpc = rpc

global.test = {
  sum: function() {

  }
}