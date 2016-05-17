/* jshint ignore:start */
{{> rjsConfig}}
/* jshint ignore:end */

module = null;

define('main', ['exports', 'checkerboard', 'mithril', 'autoconnect', 'login', 'cookies', 'modal', 'configurationActions', 'interact'], function(exports, checkerboard, m, autoconnect, login, cookies, modal, configurationActions, interact) {
  /* jshint ignore:start */
  var wsAddress = 'ws://' + window.location.hostname + ':' + {{ws}};
  /* jshint ignore:end */  var stm = new checkerboard.STM(wsAddress);
  autoconnect.monitor(stm.ws);

  document.body.addEventListener('mousewheel', function(e) {
    return e.preventDefault(), false;
  });

  document.body.addEventListener('touchmove', function(e) {
    if (e.target.tagName !== 'INPUT')
      return e.preventDefault(), false;
  });

  var panels, loadApp;
  stm.init(function(store) {
    configurationActions.load(stm);
    store.sendAction('init');
    var el = document.getElementById('root');
    var classroom;
    store.addObserver(function(){});
    login.display(el, {
      'student': false,
      'store': store
    }, function(_classroom) {
      classroom = _classroom;
      m.mount(el, m.component(panelComponent, {'classroom': classroom, 'panels': store.classrooms[classroom].projections}));
      m.render(el, m.component(panelComponent, {'classroom': classroom, 'panels': store.classrooms[classroom].projections}));
      store.classrooms[classroom].addObserver(function(classroom) {
        m.render(el, m.component(panelComponent, {'classroom': classroom, 'panels': classroom.projections}));
      });
    });
  });

  var panelComponent = {
    'controller': function(args) {
        interact('.appPanel')
          .draggable({
            'autoscroll': false,
            'onstart': function(event) {
              var zIndex = 0;
              [].forEach.call(document.getElementsByClassName('appPanel'), function(panel) {
                if (isNaN(parseInt(panel.style.zIndex)))
                  args.panels[panel.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, 0);
                else if (parseInt(panel.style.zIndex) > zIndex)
                  zIndex = parseInt(panel.style.zIndex);

                args.panels[panel.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, parseInt(panel.style.zIndex) - 1);
              });
              console.log(zIndex);
              args.panels[event.target.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, zIndex);
            },
            'onmove': function(event) {
              var target = event.target,
                x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
                y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy,
                a = (parseFloat(target.getAttribute('data-a')) || 0),
                s = (parseFloat(target.getAttribute('data-s')) || 1);

              args.panels[target.getAttribute('data-index')].sendAction('update-projection', x, y, a, s);
            }
          })
          .gesturable({
            'onstart': function(event) {
              var zIndex = 0;
              [].forEach.call(document.getElementsByClassName('appPanel'), function(panel) {
                //if (isNaN(parseInt(panel.style.zIndex)))
                //  args.panels[panel.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, 0);
                //else if (parseInt(panel.style.zIndex) > zIndex)
                //  zIndex = parseInt(panel.style.zIndex);

                //args.panels[panel.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, parseInt(panel.style.zIndex) - 1);
              });

              //args.panels[event.target.getAttribute('data-index')].sendAction('update-projection', undefined, undefined, undefined, undefined, zIndex);

            },
            'onmove': function(event) {
              var target = event.target,
                x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
                y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy,
                a = (parseFloat(target.getAttribute('data-a')) || 0) + event.da,
                s = (parseFloat(target.getAttribute('data-s')) || 1) * (1 + event.ds);

              args.panels[target.getAttribute('data-index')].sendAction('update-projection', x, y, a, s);
            }
          });
    },
    'view': function(ctrl, args) {
      return m('div', _.pairs(args.panels).map(function(panel) {
        return m('iframe.appPanel', {
          'src': 'client?classroom=' + args.classroom + '&instance=' + panel[1].instanceId,
          'data-index': panel[0],
          'data-instance': panel[1].instanceId,
          'data-x': panel[1].x,
          'data-y': panel[1].y,
          'data-a': panel[1].a,
          'data-s': panel[1].s,
          'style': 'transform: translate(' + panel[1].x + 'px, ' + panel[1].y + 'px) rotate(' + panel[1].a + 'deg) scale(' + panel[1].s + '); z-index: ' + panel[1].z
        });
      }));
    }
  };

});