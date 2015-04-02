# Mongoose RPC

Enables easy to use RPC over mongoose/mongodb.

I made this because I did not want to open another socket or add another technology to my project as I already had a connection to mongodb using mongoose.

It works by using a tailable cursor query and streaming the records that it matches to a function which processes them further.
Functions can be exposed for use by RPC.

If you are looking for something faster use UDP with some sort of message queue.
But if you don't want to add more to your stack and already have mongoose/mongodb then this seems pretty decent.

The Schema is:

````
from: String,
to:   { type: String, default: '*' },
ttl:  { type: Date, default: function() { Date.now + 1000 } }, // Messages will be relevent 1000 ms by default
fn: String,
args: Array,
cb: String
````

But you should just use rpc.send('function name',[args],to, callback etc)

## Installation

```npm install mongoose_rpc```

Note: I have only tested this with mongoose version 3.8.23

## Usage

See go.js for more examples.

```javascript
var MongooseRPC = "require('mongoose_rpc')"

// ... Connect to mongoose etc

var collection = 'rpc'
var name = 'Test' // It is a good idea to make name unique for each process.
                  // If a process is an instance/clone of another you might do something like Instance.1 Instance.2 etc.
                  // Name should not have spaces or , or *
var rpc = new MongooseRPC(mongoose, collection, name)


// Expose a function
// There are a few ways to expose a function lets look at some.

// Method 1 Named function inline
rpc.expose(function myFunction(){})

// Method 2 (Technically Method 1 still)
function myFunction(){}
rpc.expose(myFunction)

// Method 3 using a name supplied as a string should allow you to have functions exposed with names like 01234 not that its recommended.
rpc.expose('myFunction', function() {
	
})

// Oh and start the rpc stream you probably want to do this after mongoose connects.
rpc.start()

// Sending a request to every rpc listening it uses * as the to
// no arguments
rpc.send('myFunction')

// arguments
rpc.send('myFunction', [1,2,3])

// no arguments callback
rpc.send('myFunction', function(err,result){ 
   if (err) {
     console.error(err)
     return
   }

   console.log('Result is: '+result)
})

// Choosing who a request goes to such as Instance1.1
rpc.send('myFunction',[0], 'Instance1.1')

// All instances of 1
rpc.send('myFunction',[0], 'Instance1.*')

// All Instances
rpc.send('myFunction',[0], 'I.*')

// Multi Levels of .
rpc.send('myFunction',[0], 'Test.NewZealand')

// Amercia and Europe etc seperate multiple receipents with a comma and space ', '.
rpc.send('myFunction',[0], 'Amercia, Europe')


// Expose a function to do something and return
function sum(a,b) {
	return a+b
}

rpc.expose(sum)

// Ask a process with name of Calculator to do a sum function and give you a result
var args = [1,4]
rpc.send('sum',args,'Calculator', function(err, result){
if (err) {
  console.error(err)
  return
}
	
console.log('The sum of '+args+' is '+result)
})

// Trigger error on exposed function
function asdf() {
  throw new Error('Not the bees!');
}

// Or another way
function asdf2() {
  this.error('Poop')
}


// On an exposed function say you will take longer than is set to do a function
// May be usefull if generating a lot of data or doing async requests etc.
// This will ensure the thing that asked you to execute will keep its callback around at least that long.
function e() {
	this.expandTTL(60000) // Ask for an extra minute
}

// Saying you had an error in your exposed function to the thing asking you to execute it
function e(a) {
	if (!Array.isArray(a) || a.length < 4) {
	   this.error('Expecting argument a to be an array and have at least a length of 4')
       return
    }

    // do something with a eg max
    return Math.max.apply(null, a)
}

// Returning a result from an exposed function more than once or in a closure

function e(a) {
	
	var request = this;
	setTimeout(function() {
        request.result(10)
	},5)
    
}


// Sending a request with an increased ttl (TTL means time to live by the way it is roughly how long to keep a callback around if set and how long other clients should accept messages.)

rpc.send('doSomething', [1,2,3], function(err,data){  console.log(data) }, 3600000) // 1 hour

// If a client starts up it will accept messages that were sent out for it prior to its startup if their ttl >= Date.now()

// Ping
rpc.ping()

// Ping named
rpc.ping('Test')

// ping using latency in function
rpc.ping('*', function(who, latency){ console.log('Ping to '+who+' took '+latency+' ms.') })

```

You can also error inside your function handler with an exception throw or return this.error('A problem happened!')

## Dependencies

- node-uuid
- mongoose

## Issues

Have an issue to report?
Just report it on github here: [New Issue](https://github.com/LiamKarlMitchell/mongoose_rpc/issues)

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## History



## Credits

Liam Mitchell

## License

MIT