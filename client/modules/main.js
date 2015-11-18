requirejs.config({
  'paths': {
    'interact': '/lib/interact',
    'mithril': '/lib/mithril',
    'checkerboard': '/lib/checkerboard',
    'cookies': '/shared/cookies',
    'clientUtil': '/shared/clientUtil',
    'underscore': '/lib/underscore'
  },
  'shim': {
    'underscore': {
      'exports': '_'
    }
  }
});

module = null;

define('main', ['exports', 'checkerboard', 'mithril', 'clientUtil', './selector', './cornerMenu', 'cookies', 'modal'], function(exports, checkerboard, m, clientUtil, selector, cornerMenu, cookies, modal) {  
  var wsAddress = 'ws://' + window.location.hostname + ':' + (clientUtil.parameter('port') || '1808');
  var stm = new checkerboard.STM(wsAddress);
  var selected, classroom = null, device = null;
  var _store;
  
  if (clientUtil.parameter('electron')) {
    require('ipc').send('client-connected');
    require('electron-cookies');
  }
  
  document.body.addEventListener('mousewheel', function(e) {
    return e.preventDefault(), false;
  });
  
  document.body.addEventListener('touchmove', function(e) {
    if (e.target.tagName !== 'INPUT')
      return e.preventDefault(), false;
  });
  
  var rec = stm.ws.onclose = function() {
    document.getElementById('app').classList.add('frozen');
    modal.display('Disconnected. Trying to reconnect...');
    document.body.classList.add('disconnected');
    ws = new WebSocket('ws://' + window.location.hostname + ':' + (clientUtil.parameter('port') || '1808'));
    ws.onopen = function() {
      location.reload();
    }
    ws.onerror = rec;
  };
  
  var deviceObserver, loadApp;
  stm.init(function(store) {
    stm.action('set-identity')
    .onReceive(function(_classroom, _device) {
      selected = true;
      classroom = _classroom;
      device = _device;
      m.redraw();
      store.classrooms[classroom].devices[device].addObserver(deviceObserver);
      modal.display('Connected to:<br>' + store.classrooms[classroom].name + '<br>' + store.classrooms[classroom].devices[device].name);
      return false;
    });
    
    m.mount(document.getElementById('navs'), m.component(main, store));
    
    deviceObserver = function(newValue, oldValue) {
      if (oldValue === null || newValue.app !== oldValue.app) {
        loadApp(newValue.app);
      }
    };
    
    loadApp = function(app) {
      var actionProxy = function(action) {
        return stm.action(action);
      };
      
      requirejs(['/apps/' + app + '/' + store.apps[app].client], function(appModule) {
        var params = {
          'device': device
        };
        appModule.load(document.getElementById('app'), actionProxy, store.classrooms[classroom].appRoot[app], params);
      });
    };
  });
  
  var main = {
    'view': function(args, store) {
      return m('div', [
        m.component(cornerMenu),
        !selected ? m.component(selector, store) : ''
      ]);
    }
  };
});