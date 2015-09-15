var Catalyst = (function () {

  var api;
  var videoPlayer;
  var statusBar;
  var channelPositions;
  var channelIndices;
  var currentChannelIndex = 0;
  var programEndTimer;
  var loading = false;
  var userId = null;

  function start() {
    document.querySelector('#notification').style.display = "none";

    if (localStorage.getItem("userId") != null) {
      userId = localStorage.getItem("userId");
      document.querySelector('#identify-ui').style.display = "none";

      run();
    } else {
      // identify the user
      document.querySelector('#tv-ui').style.display = "none";

      var code = Math.random().toString(36).slice(8);
      document.querySelector('#code').innerHTML = code;

      // wait for a firebase response
      var code2userid = new Firebase("https://catalysttv.firebaseio.com/code2userid/" + code);
      code2userid.on("value", function(snapshot) {
        if(snapshot.val() != null) {
          userId = snapshot.val();
          localStorage.setItem('userId', userId);

          var user = new Firebase("https://catalysttv.firebaseio.com/users/" + userId);
          user.child("avatar").on("value", function(snapshot) {
            if(snapshot.val() != null) {
              localStorage.setItem('userAvatar', snapshot.val());
              document.querySelector('#identify-ui').style.display = "none";
              run();
            }
          });

          // no need anymore
          code2userid.child(code).remove()
        }

      });
    }
  }

  function run() {
    document.querySelector('#tv-ui').style.display = "";

    document.querySelector('#userAvatar').style.backgroundImage = "url("+localStorage.getItem('userAvatar')+")";

    var user = new Firebase("https://catalysttv.firebaseio.com/users/" + localStorage.getItem('userId'));
    user.child("notification").on("value", function(snapshot) {
      console.debug("notification value: " + snapshot.val());
      if(snapshot.val() != null) {
        document.querySelector('#notification').style.display = "";
        document.querySelector('#notification').innerHTML = snapshot.val();
        user.child("notification").remove()
        setTimeout(function() {
          document.querySelector('#notification').style.display = "none";
        }, 5000);
      }
    });

    api = new APIClient();
    videoPlayer = document.querySelector('#video-player');
    statusBar = new StatusBar(document.querySelector('#status-bar'));

    api.fetchChannels()
      .then(function (data) {
        channelPositions = data.positions;
        channelIndices = data.indices;

        handleChannelChange(1);
      });

    window.addEventListener('keydown', function (event) {
      if (loading) {
        return;
      }

      switch (event.keyCode) {
        //case 38: // Up
        case 33: // PageUp
          handleChannelUp();
          break;

        //case 40: // Down
        case 34: // PageDown
          handleChannelDown();
          break;

        case 13: // Enter
          if (videoPlayer.paused) {
            videoPlayer.play();
            break;
          }
          videoPlayer.pause();
          break;
      }
    }, false);
  }

  function notifyViewingChange(metadata) {
    var user = new Firebase("https://catalysttv.firebaseio.com/users/" + userId);
    user.child("viewing").set(metadata);
    user.child("viewing_channel").set(channelIndices[currentChannelIndex]);
  }

  function handleChannelUp() {
    currentChannelIndex = calculateTargetChannelIndex(+1);

    handleChannelChange(channelIndices[currentChannelIndex]);
  }

  function handleChannelDown() {
    currentChannelIndex = calculateTargetChannelIndex(-1);

    handleChannelChange(channelIndices[currentChannelIndex]);
  }

  function handleProgramEnd() {
    var channelNumber = channelIndices[currentChannelIndex];
    var channelSettings = channelPositions[channelNumber];

    if (!channelSettings) {
      return;
    }

    loading = true;

    api.fetchMetadataByChannel(channelSettings.id)
      .then(function (metadata) {
        notifyViewingChange(metadata);
        statusBar.update(metadata);
        rescheduleProgramEndTimer(metadata.now);

        loading = false;
      });
  }

  function handleChannelChange(channelNumber) {
    var channelSettings = channelPositions[channelNumber];

    if (!channelSettings) {
      return;
    }

    clearProgramEndTimer();

    videoPlayer.src = channelSettings.manifest;
    loading = true;

    api.fetchMetadataByChannel(channelSettings.id)
      .then(function (metadata) {
        notifyViewingChange(metadata);
        statusBar.update(metadata);
        rescheduleProgramEndTimer(metadata.now);

        loading = false;
      });
  }

  function rescheduleProgramEndTimer(metadata) {
    var interval = calculateProgramEndTimer(metadata);

    setTimeout(handleProgramEnd, interval);
  }

  function clearProgramEndTimer() {
    clearTimeout(programEndTimer);
  }

  function calculateTargetChannelIndex(delta) {
    var totalChannels = channelIndices.length;
    var targetIndex = currentChannelIndex + delta;

    if (targetIndex < 0) {
      return totalChannels - 1;
    }

    if (targetIndex >= totalChannels) {
      return 0;
    }

    return targetIndex;
  }

  function calculateProgramEndTimer(metadata) {
    return metadata.end - Date.now() + 5000;
  }


  function APIClient() {
    this.baseURL = 'http://appathon.lgi.io/kraken/v2/schedule/data/NL';
  }

  APIClient.prototype.fetch = function (url) {
    return new Promise(function (resolve, reject) {
      var transport = new XMLHttpRequest();

      transport.onload = function () {
        var response;

        if (this.status === 200) {
          try {
            response = JSON.parse(this.responseText);
          } catch (error) {
            return reject(new Error('Invalid JSON received'));
          }

          resolve(response);
        } else {
          reject(this.status);
        }
      };

      transport.onerror = function () {
        reject(new Error('Network error'));
      };

      transport.open('GET', url);
      transport.setRequestHeader('X-Auth-Id', 'appathon2015');
      transport.setRequestHeader('X-Auth-Key', 'YGEtfmVtAnWfB8G9DIq9za8He3of9ioRQTDRyKxz0zw=');
      transport.send(null);
    });
  };

  APIClient.prototype.fetchChannels = function () {
    var queryString = [
      'stream.available=true',
      'fields=ref,name,logicalPosition,stream',
      'sort=logicalPosition(asc)',
      'limit=500'
    ].join('&');

    return this.fetch(this.baseURL + '/channels.json?' + queryString)
      .then(function (response) {
        var channelList = response.data;
        var positions = channelList.reduce(function (map, channel) {
          map[channel.logicalPosition] = {
            manifest: channel.stream.url,
            id: channel.stream.contentId
          };

          return map;
        }, {});

        var indices = channelList.map(function (channel) {
          return channel.logicalPosition;
        });

        return {
          positions: positions,
          indices: indices
        };
      });
  };

  APIClient.prototype.fetchNowPlayingMetadata = function (channelId) {
    var now = new Date().toJSON();
    var queryString = [
      'channel.ref=' + channelId,
      'start<=' + now,
      'end>=' + now,
      'fields=start,end,video.title',
      'limit=1'
    ].join('&');

    return this.fetch(this.baseURL + '/broadcasts.json?' + queryString)
      .then(function (response) {
        var data = response.data[0];

        return {
          title: data.video.title,
          start: new Date(data.start),
          end: new Date(data.end)
        };
      });
  };

  APIClient.prototype.fetchUpcomingMetadata = function (channelId) {
    var now = new Date().toJSON();
    var queryString = [
      'channel.ref=' + channelId,
      'start>' + now,
      'fields=start,end,video.title',
      'sort=start',
      'limit=1'
    ].join('&');

    return this.fetch(this.baseURL + '/broadcasts.json?' + queryString)
      .then(function (response) {
        var data = response.data[0];

        return {
          title: data.video.title,
          start: new Date(data.start),
          end: new Date(data.end)
        };
      });
  };

  APIClient.prototype.fetchMetadataByChannel = function (channelId) {
    var nowPlayingRequest = this.fetchNowPlayingMetadata(channelId);
    var upcomingRequest = this.fetchUpcomingMetadata(channelId);

    return Promise.all([nowPlayingRequest, upcomingRequest])
      .then(function (results) {
        return {
          now: results[0],
          upcoming: results[1]
        };
      });
  };


  function StatusBar(element) {
    this.element = element;

    this.progressBar = new ProgressBar(this.element.querySelector('.progress'));
    this.nowPlayingLabel = new MetadataLabel(this.element.querySelector('.now-playing'));
    this.upcomingLabel = new MetadataLabel(this.element.querySelector('.upcoming'));
  }

  StatusBar.prototype.update = function (metadata) {
    var nowPlayingData = metadata.now;
    var upcomingData = metadata.upcoming;
    var progressPercent = this.calculateProgress(nowPlayingData.start, nowPlayingData.end);

    this.progressBar.update(progressPercent);
    this.nowPlayingLabel.update(nowPlayingData);
    this.upcomingLabel.update(upcomingData);
  };

  StatusBar.prototype.clear = function () {
    this.progressBar.clear();
    this.nowPlayingLabel.clear();
    this.upcomingLabel.clear();
  };

  StatusBar.prototype.show = function () {
    this.element.classList.add('visible');
  };

  StatusBar.prototype.hide = function () {
    this.element.classList.remove('visible');
  };

  StatusBar.prototype.calculateProgress = function (start, end) {
    var now = Date.now();
    var duration = end - start;
    var elapsed = now - start;

    return Math.min(100, Math.ceil(elapsed / duration * 100));
  };

  function ProgressBar(element) {
    this.element = element;
  }

  ProgressBar.prototype.update = function (value) {
    this.element.firstElementChild.style.width = value + '%';
  };

  ProgressBar.prototype.clear = function () {
    this.update(0);
  };

  function MetadataLabel(element) {
    this.element = element;
    this.title = this.element.querySelector('.title');
    this.timeSlot = this.element.querySelector('.time-slot');
  }

  MetadataLabel.prototype.update = function (metadata) {
    var startTime = this.formatTime(metadata.start);
    var endTime = this.formatTime(metadata.end);

    this.title.textContent = metadata.title;
    this.timeSlot.textContent = startTime + ' - ' + endTime;
  };

  MetadataLabel.prototype.clear = function () {
    this.title.textContent = '-';
    this.timeSlot.textContent = '-';
  };

  MetadataLabel.prototype.formatTime = function (date) {
    var hours = this.padNumber(date.getHours());
    var minutes = this.padNumber(date.getMinutes());

    return hours + ':' + minutes;
  };

  MetadataLabel.prototype.padNumber = function (number) {
    return ('0' + number).slice(-2);
  };

  return {
    start: start
  };

}());
