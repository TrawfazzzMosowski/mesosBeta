////////////////////////////////////////////////////////////////////////////////
// Remove to run within New Relic Synthetics
if ($http == null) { var $http = require('request'); }
////////////////////////////////////////////////////////////////////////////////

// Config values:
// APP_NAME - name of the app, will be used as the name in the Plugin list
// ACCOUNT - account id to read the JMX metrics from
// API_KEY - where to read the JMX metrics from
// APP_ID - application id that has the JMX metrics
// LICENSE - where the plugin should report
var config = {
  'SCRIPTNAME': 'jmx-to-plugin',
  'VERSION': '1.0.2',
  'GUID': 'com.adg.newrelic.plugin.Kafka',
  'APP_NAME': 'Kafka',
  'ACCOUNT': 'xxx',
  'API_KEY': 'xxx',
  'APP_ID': 'xxx',
  'LICENSE': 'xxx',
}

var metricList;
var currentChunkCount = 0;
var totalChunkCount = 0;


////////////////////////////////////////
// Main Code
////////////////////////////////////////

// Get the JMX metric names
var getMetricNames = function(appId, appName) {
  console.log('getMetricNames(' + appName + ') starting.');

  // Create the parameters then call the API
  var params = { 'application_id': appId, 'name': 'JMX', 'page': '1' }
  Applications.metricNames(params, function(data) {
    console.log('- inside getMetricNames callback');
    
    // Create a new metric name object
    metricList = {};

    for (var page=0; page < data.pages.length; page++) {
      var pagedata = data.pages[page];
      var metrics = pagedata.metrics;

      // Add each metric name to the object
      for (var i=0; i < metrics.length; i++) {
        name = metrics[i].name;
        metricList[name] = {'average': -1};
      }
    }

    console.log('getMetricNames(' + appName + ') complete, ' + Object.keys(metricList).length + ' metric names received.');
    getMetricValues(appId, appName);
  });
}

// Get the metric values
var getMetricValues = function(appId, appName) {
  console.log('getMetricValues(' + appName + ') starting.');
  
  // Push all the names into an array
  var nameArr = [];
  for(metricName in metricList) {
    nameArr.push(metricName);
  }
  totalChunkCount = Math.ceil( nameArr.length / 50);
  console.log('Total Chunk Count: ' + totalChunkCount);

  // Get groups of 50 metrics at a time
  for (var i=0; i < nameArr.length; i+=50) {
    var slice = nameArr.slice(i, i+50);
    var param = {
      'application_id': appId,
      'names': slice,
    };
    var metricCount = 0;

    Applications.metricData(param, function(data) {
      currentChunkCount++;
      console.log('- inside metricDataCallback callback, chunk: ' + currentChunkCount + ' of ' + totalChunkCount);
      
      for (var page=0; page < data.pages.length; page++) {
        var pagedata = data.pages[page];
        var metrics = pagedata.metric_data.metrics;
        metricCount += metrics.length;
        
        // Loop over the metrics
        for (var i=0; i < metrics.length; i++) {
          var name = metrics[i].name;
          var timeslices = metrics[i].timeslices;
          var avg = timeslices[timeslices.length-1].values.average_value;
          metricList[name] = {'average': avg};
        }
      }

      // Check if this is the final callback
      // console.log('App: ' + appId + ' finished chunk (' + currentChunkCount + '/' + totalChunkCount + ')');
      if (currentChunkCount == totalChunkCount) {
        console.log('All chunks have been collected');
        console.log('getMetricValues(' + appName + ') complete, ' + metricCount + ' metric values received.');
        publishToPlugin(appId, appName, metricList);
      }
    });
  }
}

// Publish to the Plugin API
var publishToPlugin = function(appId, appName, metricList) {
  console.log('publishToPlugin(' + appName + ') starting.');
  var pluginMetricList = makeMetricNames(metricList);
  Plugins.post(appId, appName, pluginMetricList, function(data) {
    console.log('- inside publishToPlugin callback');
    console.log(data);
  });
}


////////////////////////////////////////
// API Helper Functions
////////////////////////////////////////

// Helper function to read the link header and return the next page
var linkHelper = function(link) {
  
  if (link == null) { return null; }

  // There can be parameters for first, prev, next, and last
  // Note: if last ends with 0, then we need to return null
  var lastUri = null;
  var nextUri = null;

  // Split the link value
  var paramList = link.split(',');
  for (var i=0; i < paramList.length; i++) {
    
    // Split the parameter
    var param = paramList[i].split(';');

    // Look for next and last
    if (param[1].indexOf('last') > 0) {
      lastUri = param[0].replace('<', '').replace('>', '').trim();
    } else if (param[1].indexOf('next') > 0) {
      nextUri = param[0].replace('<', '').replace('>', '').trim();
    }
  }
  
  // If last points to "cursor=" (blank cursor) we should return null
  if (nextUri != null) {
    if (nextUri.indexOf('cursor=', nextUri.length - 'cursor='.length) !== -1) {
      return null;
    }
  }

  // If last points to page=0 then we should return null
  if (lastUri != null) {
    if (lastUri.indexOf('page=0', lastUri.length - 6) !== -1) {
      return null;
    }
  }
  return nextUri;
};

// Helper function to create a new data object
var makeDataObject = function(id) {
  // Make a fresh data object
  var data = {};
  data.id = id;
  data.pages = [];
  return data;
};

// Helper function to do the GET call
var callRequest = function(data, options, cb) {
  console.log('- In callRequest(' + options.uri + ')');
  $http(options, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      // Append this response to existing data
      data.pages.push(body);

      // Check the link header, we will get the next uri to call
      var uri = linkHelper(response.headers.link);
      if (uri != null) {
        // The uri is the next page we need to get, re-use part of the options object
        var newOptions = {
          'method': options.method,
          'uri': uri,
          'headers': options.headers,
          'json': true
        };
        callRequest(data, newOptions, cb);
      } else {
        // We have all the data, so send it to the callback
        cb(data);
      }
    } else {
      if (error != null) {
        console.log('Error: ', error);
        console.log('Options: ', options);
      } else {
        // console.log('Error response code: ' + response.statusCode);
        if (response.statusCode != 404) {
          console.log('** Unsuccessful Response Code: ' + response.statusCode);
          console.log('Options: ', options);
          console.log('Body: ', body);
        }
      }
      cb(data);
    }
  });
};

var makeJsonMessage = function(appName, metricArr) {
  // Create the message to publish
  var msg = {};
  var agent = {};
  msg.agent = agent;
  agent.host = 'localhost';
  agent.pid = 1;
  agent.version = config.VERSION;

  // Create the components array
  var components = [];
  msg.components = components;
  components[0] = {};
  components[0].name = appName;
  components[0].guid = config.GUID;
  components[0].duration = 60;
  components[0].metrics = metricArr;

  return msg;
}

// Turn this: JMX/kafka.controller/ControllerStats/LeaderElectionRateAndTimeMs/Count
// Into this: Component/kafka.controller/ControllerStats/LeaderElectionRateAndTimeMs[Count]
var makeMetricNames = function(metricList) {

  var pluginMetricList = {};
  for (metricName in metricList) {
    var metricNameArr = metricName.split('/');
    var pluginMetricName = 'Component';
    for (var j=1; j < metricNameArr.length-1; j++) {
      pluginMetricName += '/' + metricNameArr[j];
    }
    var units = metricNameArr[metricNameArr.length-1];
    pluginMetricName += '[' + units + ']';
    pluginMetricList[pluginMetricName] = metricList[metricName].average;
  }

  return pluginMetricList;
}

////////////////////////////////////////
// Applications API
////////////////////////////////////////
var Applications = function(config) {
  this.config = config;
  console.log('--> API Applications created with API Key: ' + this.config.API_KEY);
};

// application_id - Application id
// name - filter metrics by name
Applications.prototype.metricNames = function(params, cb) {
  var appId = params.application_id;
  delete params.application_id;
  console.log('--> API - Applications.metricNames(' + appId + ')');
  var options = {
    'method': 'GET',
    'uri': 'https://api.newrelic.com/v2/applications/' + appId + '/metrics.json',
    'headers': {'X-Api-Key': this.config.API_KEY},
    'qs': params,
    'json': true
  };

  var data = makeDataObject(appId);
  callRequest(data, options, cb);
};

// application_id - Application id
// name[] - array of metrics
Applications.prototype.metricData = function(params, cb) {
  var appId = params.application_id;
  delete params.application_id;
  console.log('--> API - Applications.metricData(' + appId + ')');
  var options = {
    'method': 'GET',
    'uri': 'https://api.newrelic.com/v2/applications/' + appId + '/metrics/data.json',
    'headers': {'X-Api-Key': this.config.API_KEY},
    'qsStringifyOptions': { arrayFormat: 'brackets' },
    'qs': params,
    'json': true
  };
  var data = makeDataObject(appId);
  data.metricRequestCount = params.names.length;
  callRequest(data, options, cb);   
};

// Create the initial API Application object
var Applications = new Applications(config);
////////////////////////////////////////

////////////////////////////////////////
// Plugins API
////////////////////////////////////////
var Plugins = function(config) {
  this.config = config;
  console.log('--> Plugins interface created with license key: ' + this.config.LICENSE);
}

Plugins.prototype.post = function(appId, appName, metricArr, cb) {
  console.log('--> API - Plugins.post()');
  var body = makeJsonMessage(appName, metricArr);
  var options = {
    'method': 'POST',
    'uri': 'https://platform-api.newrelic.com/platform/v1/metrics',
    'headers': {'X-License-Key': this.config.LICENSE},
    'json': true,
    'body': body
  };
  var data = makeDataObject(appId);
  callRequest(data, options, cb); 
}

// Create the initial Plugins object
var Plugins = new Plugins(config);
////////////////////////////////////////

// Kick things off
getMetricNames(config.APP_ID, config.APP_NAME);