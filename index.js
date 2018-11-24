"use strict";

// Enables Python-esque formatting
// (e.g. "Hello {0}!".formatUnicorn("world") => "Hello world!")
String.prototype.formatUnicorn = String.prototype.formatUnicorn || function () {
  "use strict";
  var str = this.toString();
  if (arguments.length) {
    var t = typeof arguments[0];
    var key;
    var args = ("string" === t || "number" === t) ?
      Array.prototype.slice.call(arguments)
      : arguments[0];

    for (key in args) {
      str = str.replace(new RegExp("\\{" + key + "\\}", "gi"), args[key]);
    }
  }
  return str;
};

// Required packages
var alexa = require("alexa-app");
var request = require("request");
var ssml = require("ssml-builder");
var response_messages = require("./responses");

var StorePath = '/tmp/PlayList_'; /*NOTE: /tmp/ folder in AWS is an non-persistent scratch area.*/
var PlayListPath = '';
var PlayListTitles = [];
var PlayListIndex = 0;
var CurrentPlayList = '';

// Create Alexa skill application
var app = new alexa.app("youtube");

// Set Heroku URL
var heroku = process.env.HEROKU_APP_URL || "https://youtube-alexa.herokuapp.com";

// Variables relating to the last video searched
var metadata = null;
var last_search = null;
var is_play_list = false;
var last_token = null;
var last_playback = {};
var lang = "en-US";

// Current song is repeating
var repeat_infinitely = false;
var repeat_once = false;

/**
 * Generates a random UUID. Used for creating an audio stream token.
 *
 * @return {String} A random globally unique UUID
 */
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Returns whether a user is streaming video or not.
 * By default, if this is true, then the user also has_video() as well.
 *
 * @return {Boolean} The state of the user's audio stream
 */
function is_streaming_video() {
  return last_token != null;
}

/**
 * Returns whether a user has downloaded a video.
 * Doesn't take into account if the user is currently playing it.
 *
 * @return {Boolean} The state of the user's audio reference
 */
function has_video() {
  return last_search != null;
}

function has_playList() {
  return is_play_list;
}
/**
 * Restarts the video by injecting the last search URL as a new stream.
 *
 * @param  {Object} res    A response that will be sent to the Alexa device
 * @param  {Number} offset How many milliseconds from the video start to begin at
 */
function restart_video(res, offset) {
    // Generate new token
    last_token = uuidv4();

    // Replay the last searched audio back into Alexa
    res.audioPlayerPlayStream("REPLACE_ALL", {
      url: last_search,
      streamFormat: "AUDIO_MPEG",
      token: last_token,
      offsetInMilliseconds: offset
    });

    // Record playback start time
    last_playback.start = new Date().getTime();
}

/**
 * Fill the playlist items into array
 * @param  {String} PlayListName   The name/number of the playlist (NUMBER)
 * 
 * @return {Array} Array of Songs IDs
 */
function set_playList_Array(PlayListName){
  console.log('Read PlayList content');
  PlayListTitles = [];
  PlayListPath = StorePath + PlayListName + '.txt';
  console.log('Playlistpath:', PlayListPath);
  var fs = require('fs');
  if (fs.existsSync(PlayListPath)) {
    PlayListTitles = fs.readFileSync(PlayListPath).toString().split("\n");
    CurrentPlayList = PlayListName;
  }
  return PlayListTitles;
}

/**
 * Get the next Title from the current playlist
 * 
 * @return {String} Song ID
 */
function get_next_title(){
  PlayListTitles.forEach(function(entry) {
      console.log('item vor:', entry);
    });
    
  var length = PlayListTitles.length -1; //-1 since the last item is the empty part after \n character.
  var title = '';
  PlayListIndex += 1;
  
  if (length > PlayListIndex) {
    title = PlayListTitles[PlayListIndex];
    console.log('title:', title);
    console.log('increment');
  } else {
    PlayListIndex = 0;
    title = PlayListTitles[PlayListIndex];
    console.log('init');
  }
  return title;
}

/**
 * Get the previous Title from the current playlist
 * 
 * @return @return {String} Song ID
 */
function get_prev_title(){
  PlayListTitles.forEach(function(entry) {
      console.log('item vor:', entry);
    });
    
  var length = PlayListTitles.length -1; //-1 since the last item is the empty part after \n character.
  var title = '';
  PlayListIndex -= 1;
  
  if (length > PlayListIndex && PlayListIndex >= 0) {
    title = PlayListTitles[PlayListIndex];
    console.log('title:', title);
    console.log('increment');
  } else {
    PlayListIndex = length-1;
    title = PlayListTitles[PlayListIndex];
    console.log('init');
  }
  return title;
}

/**
 * Downloads the YouTube video audio via a Promise.
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function getSingleVideo(req, res, lang) {
  var query = req.slot("VideoQuerys");

  console.log("Searching ... " + query);
  if (query == null){
    res.say(response_messages[req.data.request.locale]["NO_QUERY_DEFINED"]).send();
  
  }else{
    return get_video(query, res, lang);
  }
}

/**
 * Downloads the YouTube video audio via a Promise.
 *
 * @param  {String} query  A song ID
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function get_video(query, res, lang){
    return new Promise((resolve, reject) => {
      var search = heroku + "/alexa-search/" + new Buffer(query).toString("base64");
      console.log('query:', query);
      
      // Add German to search query depending on the intent used
      if (lang === "de-DE") {
        search += "?language=de";
      }
	  
	  // Add Italian search query depending on the intent used
	  if (lang === "it-IT") {
		search += "?language=it";
	  }
		
      // Make request to download server
      request(search, function(err, res, body) {
        if (err) {
          // Error in the request
          reject(err.message);
        } else {
          // Convert body text in response to JSON object
          var body_json = JSON.parse(body);
          if (body_json.status === "error" && body_json.message === "No results found") {
            // Query did not return any video
            resolve({
              message: response_messages[lang]["NO_RESULTS_FOUND"].formatUnicorn(query),
              url: null,
              metadata: null
            });
            
          } else {
            // Set last search & token to equal the current video's parameters
            metadata = body_json.info;
            last_search = heroku + body_json.link;
            last_token = uuidv4();
  
            console.log("YouTube URL: " + metadata.original);
  
            wait_for_video(metadata.id, function() {
              console.log("Audio URL: " + last_search);
  
              // Return audio URL from request to promise
              resolve({
                message: response_messages[lang]["NOW_PLAYING"].formatUnicorn(metadata.title),
                url: last_search,
                metadata: metadata
              });
            });
          }
        }
      });
  
    }).then(function(content) {
      // Have Alexa say the message fetched from the Heroku server
      var speech = new ssml();
      speech.say(content.message);
      res.say(speech.ssml(true));
  
      if (content.url) {
        // Generate card for the Alexa mobile app
        var metadata = content.metadata;
        res.card({
          type: "Simple",
          title: "Search for \"" + query + "\"",
          content: "Alexa found \"" + metadata.title + "\" at " + metadata.original + "."
        });
        // Start playing the video!
        restart_video(res, 0);
      }
  
      // Send response to Alexa device
      res.send();
    }).catch(function(reason) {
      // Error in promise
      res.fail(reason);
    });
}
/**
 * Blocks until the audio has been loaded on the server.
 *
 * @param  {String}   id       The ID of the video
 * @param  {Function} callback The function to execute about load completion
 */
function wait_for_video(id, callback) {
  setTimeout(function() {
    request(heroku + "/alexa-check/" + id, function(err, res, body) {
      if (!err) {
        var body_json = JSON.parse(body);
        if (body_json.downloaded) {
          callback();
        }
        else {
          wait_for_video(id, callback);
        }
      }
    });
  }, 2000);
}

/**
 * Call a playlist with it name
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function play_list(req, res, lang) {
  var query = req.slot("PlayListQuerys");
  
  console.log("Searching ... " + query);
  if (query == null){
    res.say(response_messages[req.data.request.locale]["NO_PLIST_QUERY_DEFINED"]).send();
  }else{
    PlayListTitles = set_playList_Array(query);
    if(PlayListTitles.length == 0){
      res.say(response_messages[req.data.request.locale]["NO_PLIST_FOUND"]).send();
    }else{
      var title = get_next_title();
      is_play_list = true;
      return get_video(title, res, lang);
    }
  }
}

/**
 * Play the next Song of the current Playlist
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function play_next(req, res, lang){
  set_playList_Array(CurrentPlayList);
  var title = get_next_title();
  return get_video(title, res, lang);
}

/**
 * Play the previous Song of the current Playlist
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function play_prev(req, res, lang){
  set_playList_Array(CurrentPlayList);
  var title = get_prev_title();
  return get_video(title, res, lang);
}

/**
 * Play the next Song of the current Playlist
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function play_list_next(req, res, offset) {
    // Generate new token
    last_token = uuidv4();

    set_playList_Array(CurrentPlayList);
    var title = get_next_title();
    get_video(title, res, lang);
  
    last_search = heroku + '/site/' + title + '.m4a';
    
    // Replay the last searched audio back into Alexa
    res.audioPlayerPlayStream("REPLACE_ALL", {
      url: last_search,
      streamFormat: "AUDIO_MPEG",
      token: last_token,
      offsetInMilliseconds: offset
    });

    // Record playback start time
    last_playback.start = new Date().getTime();
}

/**
 * Check wherever the Song ID exists or not
 *
 * @param  {String} PlayListName  A Playlist name
 * @param  {Object} id A Song ID
 * @return {BOOLEAN} True if Exists, False else
 */
function isIDExists(PlayListName, id){
  //Check if file exists and get PlayList items
  var fs = require('fs');
  if (fs.existsSync(StorePath + PlayListName + '.txt')) {
    PlayListTitles = set_playList_Array(PlayListName);
    //Check if ID already exits in PlayList
    if (PlayListTitles.indexOf(id) > -1) {
      //In the array!
      return true;
    } else {
      return false;
    }
  }else{
    return false;
  }
}

/**
 * Add Song to the PlayList specific with Playlist Name
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 */
function add_to_play_list(req, res, lang){
  var song_ID = '';
  var query = req.slot("PlayListQuerys");
  if (query == null){
    res.say(response_messages[req.data.request.locale]["NO_PLIST_QUERY_DEFINED"]).send();
  }else if(isNaN(query)){
    res.say(response_messages[req.data.request.locale]["ONLY_NUMBER_PLIST_QUERY"]).send();
  }else if(has_video()){
    var fs = require('fs');
    if (fs.existsSync(StorePath + query + '.txt')) {
      //Check if ID exist
      var isIDexists = isIDExists(query, metadata.id);
      if(isIDexists){
        res.say(response_messages[req.data.request.locale]["ALREADY_IN_PLAYLIST"].formatUnicorn(query));
      }else{
        //Create PlayList file if not exists and insert the title ID
        console.log('insert in PlayList content');
        song_ID = metadata.id + '\n';
        console.log('song_ID:', song_ID);
            
        fs.appendFile(StorePath + query + '.txt', song_ID, function (err) {
          if (err) throw err;
        });
        res.say(response_messages[req.data.request.locale]["ADD_TO_PLAYLIST"].formatUnicorn(query)); 
      }
    }else{
      //Create PlayList file if not exists and insert the title ID
      console.log('insert in PlayList content');
      song_ID = metadata.id + '\n';
      console.log('song_ID:', song_ID);
            
      fs.appendFile(StorePath + query + '.txt', song_ID, function (err) {
        if (err) throw err;
      });
      res.say(response_messages[req.data.request.locale]["ADD_TO_PLAYLIST"].formatUnicorn(query)); 
    }
  }
}

/**
 * Remove Song from the PlayList specific with Playlist Name
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 */
function remove_from_play_list(req, res, lang){
  //Check if ID exist
  var isIDexists = isIDExists(CurrentPlayList, metadata.id);
  if(isIDexists){
    PlayListTitles = set_playList_Array(CurrentPlayList);
    
    PlayListTitles.forEach(function(entry) {
      console.log('item vor:', entry);
    });
    
    var idIndex = PlayListTitles.indexOf(metadata.id);
    PlayListTitles.splice(idIndex, 1);
    
    PlayListTitles.forEach(function(entry) {
      console.log('item after:', entry);
    });
    
    //remove PlayList file
    var fs = require('fs');
    fs.unlink(PlayListPath);
    console.log('PlayListTitles.length:', PlayListTitles.length);
    
    PlayListTitles.forEach(function(entry) {
      if(entry){
        fs.appendFile(PlayListPath, entry + '\n', function (err) {
          if (err) throw err;
        });
      }
    });
    
    res.say(response_messages[req.data.request.locale]["REMOVE_FROM_PLAYLIST"]);
  }else{
    res.say(response_messages[req.data.request.locale]["NOT_IN_PLAYLIST"]);
  }
}

/**
 * Remove PlayList specific with Playlist Name
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 */
function remove_play_list(req, res, lang){
  var query = req.slot("PlayListQuerys");
  if (query == null){
    res.say(response_messages[req.data.request.locale]["NO_PLIST_QUERY_DEFINED"]).send();
  }else{
    //Check if file exists
    var is_file_removed = remove_file(StorePath + query + '.txt');
    if(is_file_removed){
      res.say(response_messages[req.data.request.locale]["PLAYLIST_REMOVED"].formatUnicorn(query)).send();
    }else{
      res.say(response_messages[req.data.request.locale]["NO_PLIST_FOUND"]).send();
    }
  }
}

/**
 * Remove file
 *
 * @param  {String} file_path  A path of the file to be removed
 * @return  {Boolean} True if file has been removed, False else
 */
function remove_file(file_path){
  var fs = require('fs');
    console.log('PlayListPath', file_path);
    if (fs.existsSync(file_path)) {
      //remove PlayList file
      fs.unlink(file_path);
      return true; // Done file was removed
    }else{
      return false; // Failed file wasn't removed
    }
}

/**
 * Remove All PlayLists files
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 */
function remove_all_playlists(req, res, lang){
  console.log('remove_all_playlists');
  
  var isCleared = clear_dir('/tmp/');
  console.log(isCleared);
  if(isCleared){
    res.say(response_messages[req.data.request.locale]["ALL_PLAYLISTS_REMOVED"]).send();
  }else{
    res.say(response_messages[req.data.request.locale]["NO_PLIST_FOUND"]).send();
  }
}

/**
 * Get All PlayLists files
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 */
function get_all_playlists(req, res, lang){
  console.log('get_all_playlists');

  var playlists = '';
  const fs = require('fs');
  fs
    .readdirSync('/tmp/')
    .forEach((file) => {
      if ((file.slice(-4) === '.txt') && (file.indexOf('PlayList_') > -1)){
        console.log(file);
        playlists += (file.split('PlayList_')[1]).split('.txt')[0] + ', ';
      }
        
  });
  if(playlists){
    playlists = playlists.slice(0, -2); //remove the last ','
    var lastComma = playlists.lastIndexOf(",") + 1;
    if(lastComma != 0){
      playlists = playlists.slice(0, lastComma) + response_messages[req.data.request.locale]["AND"] + playlists.slice(lastComma);
    }
    res.say(response_messages[req.data.request.locale]["GET_ALL_PLAYLISTS"].formatUnicorn(playlists)).send();
  }else{
    res.say(response_messages[req.data.request.locale]["NO_PLIST_FOUND"]).send();
  }
}

/**
 * Clear directory: remove all files in directory
 *
 * @param  {String} dir_path  A Path of the directory
 */
function clear_dir(dir_path){
  const fs = require('fs');
  var isDone = false;
  
  fs
    .readdirSync(dir_path)
    .forEach((file) => {
      if ((file.slice(-4) === '.txt') && (file.indexOf('PlayList_') > -1)){
        console.log(file);
        var is_file_removed = remove_file('/tmp/' + file);
        if(is_file_removed){
          isDone = true;
        }
      }
        
  });
  return isDone;
}

// Filter out bad requests (the client's ID is not the same as the server's)
app.pre = function(req, res, type) {
  if (req.data.session !== undefined) {
    if (req.data.session.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  }
  else {
    if (req.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  }
};

// Looking up a video in English
app.intent("GetVideoIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "search for {-|VideoQuery}",
      "find {-|VideoQuery}",
      "play {-|VideoQuery}"
    ]
  },
  function(req, res) {
    lang = "en-US";
    return getSingleVideo(req, res, lang);
  }
);

// Looking up a video in German
app.intent("GetVideoGermanIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "suchen nach {-|VideoQuery}",
      "finde {-|VideoQuery}",
      "spielen {-|VideoQuery}"
    ]
  },

  function(req, res) {
    lang = "de-DE";
    return getSingleVideo(req, res, lang);
  }
);

// Looking up a video in Italian
app.intent("GetVideoItalianIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "di cercare {-|VideoQuery}",
      "cerca {-|VideoQuery}",
      "di riprodurre {-|VideoQuery}",
	  "riproduci {-|VideoQuery}"
    ]
  },
  
    function(req, res) {
    lang = "it-IT";
    return getSingleVideo(req, res, lang);
  }
);

// Looking up a play list
app.intent("GetPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "play list {-|PlayListQuery}"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return play_list(req, res, lang);
  }
);

// Looking up a play list in Italian
app.intent("GetItalianPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "di cercare la playlist {-|PlayListQuery}",
	  "di cercare la playlist {-|PlayListQuery}"
    ]
  },
  function(req, res) {
    lang = "it-IT";
    return play_list(req, res, lang);
  }
);

// Add item to the play list
app.intent("SetPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "in play list {-|PlayListQuery} einfügen",
      "in playlist {-|PlayListQuery} einfügen"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return add_to_play_list(req, res, lang);
  }
);

// Add item to the play list in Italian
app.intent("SetItalianPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "di inserire nella playlist {-|PlayListQuery}",
      "di inserire nella play list {-|PlayListQuery}"
    ]
  },
  function(req, res) {
    lang = "it-IT";
    return add_to_play_list(req, res, lang);
  }
);

// Remove item from play list
app.intent("RemoveIdPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "von play list {-|PlayListQuery} entfernen",
      "von playlist {-|PlayListQuery} entfernen"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return remove_from_play_list(req, res, lang);
  }
);

// Remove item from play list in Italian
app.intent("RemoveIdPlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "di rimuovere dalla playlist {-|PlayListQuery}",
      "di rimuovere dalla play list {-|PlayListQuery}"
    ]
  },
  function(req, res) {
    lang = "it-IT";
    return remove_from_play_list(req, res, lang);
  }
);

// Remove playlist
app.intent("RemovePlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "von play list {-|PlayListQuery} entfernen",
      "von playlist {-|PlayListQuery} entfernen"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return remove_play_list(req, res, lang);
  }
);

// Remove playlist in Italian
app.intent("RemovePlayListIntent", {
    "slots": {
      "PlayListQuery": "VIDEOS"
    },
    "utterances": [
      "di rimuovere la playlist {-|PlayListQuery}",
      "di rimuovere la playlist {-|PlayListQuery}"
    ]
  },
  function(req, res) {
    lang = "it-IT;
    return remove_play_list(req, res, lang);
  }
);

// Remove all playlists
app.intent("RemoveAllPlayListIntent", {
    "utterances": [
      "alle play list entfernen",
      "alle playlist entfernen"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return remove_all_playlists(req, res, lang);
  }
);

// Remove all playlists
app.intent("RemoveAllPlayListIntent", {
    "utterances": [
      "di rimuovere tutte le playlist",
      "di rimuovere tutte le playlist"
    ]
  },
  function(req, res) {
    lang = "it-IT";
    return remove_all_playlists(req, res, lang);
  }
);

// Get all playlists
app.intent("GetAllPlayListIntent", {
    "utterances": [
      "alle play list entfernen",
      "alle playlist entfernen"
    ]
  },
  function(req, res) {
    lang = "de-DE";
    return get_all_playlists(req, res, lang);
  }
);

// Get all playlists
app.intent("GetAllPlayListIntent", {
    "utterances": [
      "di mostrare tutte le playlist",
      "di mostrare tutte le playlist"
    ]
  },
  function(req, res) {
    lang = "it-IT";
    return get_all_playlists(req, res, lang);
  }
);

// Log playback failed events
app.audioPlayer("PlaybackFailed", function(req, res) {
  console.error("Playback failed.");
  console.error(req.data.request);
  console.error(req.data.request.error);
});

// Use playback finished events to repeat audio
app.audioPlayer("PlaybackNearlyFinished", function(req, res) {
  // Repeat is enabled, so begin next playback
  if (has_video() || has_playList()){
    if(repeat_infinitely || repeat_once) {
      // Generate new token for the stream
      var new_token = uuidv4();
  
      // Inject the audio that was just playing back into Alexa
      res.audioPlayerPlayStream("ENQUEUE", {
        url: last_search,
        streamFormat: "AUDIO_MPEG",
        token: new_token,
        expectedPreviousToken: last_token,
        offsetInMilliseconds: 0
      });
  
      // Set last token to new token
      last_token = new_token;
  
      // Record playback start time
      last_playback.start = new Date().getTime();
  
      // We repeated the video, so singular repeat is set to false
      repeat_once = false;
  
      // Send response to Alexa device
      res.send();
    }
    if(has_playList()){ /* Play next song if Playlist */
      play_list_next(req, res, 0);
    }
  } else {
    // Token is set to null because playback is done
    last_token = null;
  }
});

// User told Alexa to start over the audio
app.intent("AMAZON.StartOverIntent", {}, function(req, res) {
  if (has_video()) {
    // Replay the video from the beginning
    restart_video(res, 0);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }
  res.send();
});

var stop_intent = function(req, res) {
  if (has_video()) {
    // Stop current stream from playing
    if (is_streaming_video()) {
      last_token = null;
      res.audioPlayerStop();
      is_play_list = false;
    }

    // Clear the entire stream queue
    last_search = null;
    res.audioPlayerClearQueue();
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }
  res.send();
};

// User told Alexa to stop playing audio
app.intent("AMAZON.StopIntent", {}, stop_intent);
app.intent("AMAZON.CancelIntent", {}, stop_intent);

// User told Alexa to resume the audio
app.intent("AMAZON.ResumeIntent", {}, function(req, res) {
  if (is_streaming_video()) {
    // Replay the video starting at the desired offset
    restart_video(res, last_playback.stop - last_playback.start);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});

// User told Alexa to pause the audio
app.intent("AMAZON.PauseIntent", {}, function(req, res) {
  if (is_streaming_video()) {
    // Stop the video and record the timestamp
    last_playback.stop = new Date().getTime();
    res.audioPlayerStop();
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});

// User told Alexa to repeat audio infinitely
app.intent("AMAZON.RepeatIntent", {}, function(req, res) {
  // User searched for a video but playback ended
  if (has_video() && !is_streaming_video()) {
    restart_video(res, 0);
  }
  else {
    repeat_once = true;
  }

  res.say(
    response_messages[req.data.request.locale]["REPEAT_TRIGGERED"]
      .formatUnicorn(has_video() ? "current" : "next")
  ).send();
});

// User told Alexa to repeat audio infinitely
app.intent("AMAZON.LoopOnIntent", {}, function(req, res) {
  // Enable repeating infinitely
  repeat_infinitely = true;

  // User searched for a video but playback ended
  if (has_video() && !is_streaming_video()) {
    restart_video(res, 0);
  }

  res.say(
    response_messages[req.data.request.locale]["LOOP_ON_TRIGGERED"]
      .formatUnicorn(has_video() ? "current" : "next")
  ).send();
});

// User told Alexa to stop repeating audio infinitely
app.intent("AMAZON.LoopOffIntent", {}, function(req, res) {
  repeat_infinitely = false;

  res.say(
    response_messages[req.data.request.locale]["LOOP_OFF_TRIGGERED"]
      .formatUnicorn(has_video() ? "current" : "next")
  ).send();
});

// User asked Alexa for help
app.intent("AMAZON.HelpIntent", {}, function(req, res) {
  res.say(response_messages[req.data.request.locale]["HELP_TRIGGERED"]).send();
});

// User told Alexa to play the next audio in play list
app.intent("AMAZON.NextIntent", {}, function(req, res) {
  if (is_streaming_video() && has_playList()) {
     return play_next(req, res, lang);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});

// User told Alexa to play the Previou audio in play list
app.intent("AMAZON.PreviousIntent", {}, function(req, res) {
  if (is_streaming_video() && has_playList()) {
     return play_prev(req, res, lang);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});



exports.handler = app.lambda();
