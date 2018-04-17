# Alexa_YouTube
Play Youtube Music via Alexa Echo.
Alexa_YouTube makes it easy to play music and playlist from YouTube.

## features ##
User ...
* ... doesn't need a YouTube account to groove this skill
* ... doesn't have to wait until video is completely downloaded
* ... can easily create and modify playlists
  * Playlists are identified by numbers 
    * ``` Alexa ask youtube for playlist {NUMBER}```
  * Playlists file contains only the ID of the songs and thus remains quite small
  
## Dependencies ##
Youtube API: This skills need Youtube PI service to access on Videos on Youtube for this purpose, the web app https://youtube-alexa.herokuapp.com/ was created. Of course you can also use other services or create. 

This WebApp runs on heroku server, the corresponding source code can be found [here](https://github.com/reger-men/YoutubeAPI)
