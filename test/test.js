// TODO: Write tests? I started this thinking it might be a good idea but ended up just wanting to code. Testing seems to require dedication to testing go figure.
var assert = require('assert')
var mongoose = require('mongoose')
var fs = require('fs')
var rpcPlugin = require('../index.js')

var configFile = '../config.json';
var config = {
	mongooseConnect: 'mongodb://localhost/test'
}

var Schema = mongoose.Schema;

if (fs.existsSync(configFile)) {
	configFile = JSON.parse(fs.readFileSync(configFile, 'utf8'))
}

function clearDB() {
	for (var i in mongoose.connection.collections) {
 		mongoose.connection.collections[i].remove(function() {})
	}
}


describe('test', function() {

	beforeEach(function () {

	 	if (mongoose.connection.readyState === 0) {
	   		mongoose.connect(config.mongooseConnect, function (err) {
				if (err) {
					throw err
				}
				return clearDB()
			})
		 } else {
		   return clearDB()
		 }
	})

	afterEach(function () {
		mongoose.disconnect()
		clearDB()
	})
  
  it('Should say Hello World', function(done) {
    assert.equal('Hello World', 'Hello World')
    done()
  });

  it('Should be a function', function(done) {
  	assert(rpcPlugin instanceof Function)
  	done()
  })

  it('Can save a message', function(done) {
  	
  	var queueSchema = new Schema({})
  	queueSchema.plugin(rpcPlugin, { index: true, name: 'Test', fromRegex: '^Test$|^\*$' })
	var MongooseRPC = mongoose.model('Queue', queueSchema, 'queue', false)

	var testRPC = new MongooseRPC({ Fn: 'echo', Args: ['Hello World!'] })
	testRPC.save(function (err) {
		done(err);
	})

  })


});