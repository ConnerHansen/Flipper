/*
 * Flipper is based on the Desktop Cube extension by Entelechy
 * Author: Conner Hansen
 * Last Update: May 24, 2015
 */

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const Cinnamon = imports.gi.Cinnamon;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Settings = imports.ui.settings;

let settings;
let bindings = ['switch-to-workspace-left',
                'switch-to-workspace-right',
                'move-to-workspace-left',
                'move-to-workspace-right'];

function Flipper() {
    this._init.apply(this, arguments);
}

Flipper.prototype = {
    _init: function(display, screen, window, binding) {
        this.from = null;
        this.to = null;
        this.is_animating = false;
        this.destroy_requested = false;
        this.queued_direction = null;
        this.monitor = Main.layoutManager.primaryMonitor;

        let [binding_type,,,direction] = binding.get_name().split('-');
        let direction = Meta.MotionDirection[direction.toUpperCase()];
        this.direction = direction;
        this.last_direction = direction;

        if (direction != Meta.MotionDirection.RIGHT &&
            direction != Meta.MotionDirection.LEFT)
            return;

        let active_workspace = global.screen.get_active_workspace();
        let new_workspace = active_workspace.get_neighbor(direction);
        if (active_workspace.index() == new_workspace.index())
            return;

        this.actor = new St.Group({
            reactive: false,
            x: 0,
            y: 0,
            width: global.screen_width,
            height: global.screen_height,
            visible: true });

        Main.uiGroup.add_actor(this.actor);

        this.actor.connect('key-release-event',
            Lang.bind(this, this._keyReleaseEvent));
        this.actor.connect('key-press-event',
            Lang.bind(this, this._keyPressEvent));

        this.initBackground();
        this.dimBackground();

        Main.pushModal(this.actor);

        let mask = binding.get_mask();
        this._modifierMask =
            imports.ui.appSwitcher.appSwitcher.primaryModifier(mask);
        global.window_group.hide();

        Main.getPanels().forEach(function(panel){panel.actor.opacity = 0;});

        if (binding_type == "move" &&
            window.get_window_type() !== Meta.WindowType.DESKTOP)
                this.moveWindow(window, direction);

        this.startAnimate(direction);
        this.actor.show();
    },

    const: {
      CUBE_HALF_ANGLE: 20,
      CUBE_FULL_ANGLE: 50,
      CUBE_START_ANGLE: 25,
      CUBE_HALF_ZOOM: 0.6,
      CUBE_ZOOM: 0.25,
      DECK_DROP: 5,
      DECK_HEIGHT: 20,
      DECK_ANGLE: 15,
      FLIP_ANGLE: 150,
      ROLODEX_HALF_ANGLE: 30,
      ROLODEX_FULL_ANGLE: 60,
    },

    removeWindowActor: function(workspace_clone, window, index) {
        if (workspace_clone && (workspace_clone.index == index)) {
            let i = workspace_clone.workspaceWindows.indexOf(window);
            if (i == -1) return false;
            let j;
            let done = false;
            for (j = 0; j < workspace_clone.workspaceWindows.length &&
                !done; j++) {
                if (window.get_stable_sequence() ==
                    workspace_clone.workspaceWindowActors[j].i)
                    done = true;
            }
            workspace_clone.remove_actor
                (workspace_clone.workspaceWindowActors[j-1]);
            workspace_clone.workspaceWindows.splice(i, 1);
            workspace_clone.workspaceWindowActors.splice(j-1, 1)[0].destroy();
            return true;
        }
        return false;
    },

    addWindowActor: function(workspace_clone, window, index) {
        if (workspace_clone && (workspace_clone.index == index)) {
            let windowClone = this.cloneMetaWindow(window);
            workspace_clone.add_actor(windowClone);
            //windowClone.raise_top();
            //workspace_clone.chromeGroup.raise_top();
            workspace_clone.workspaceWindowActors.push(windowClone);
            workspace_clone.workspaceWindows.push(window);
            workspace_clone.workspaceWindows.sort
                (Lang.bind(this, this._sortWindow));
            return true;
        }
        return false;
    },

    sortWindowClones: function (workspace_clone) {
        workspace_clone.workspaceWindowActors.sort(Lang.bind(this,
            function(actor1, actor2) {
                let time = this._sortWindow(actor1.win, actor1.win);
                time > 0 ? actor1.raise(actor2) : actor2.raise(actor1);
                return 0;
            }));
        workspace_clone.chromeGroup.raise_top();
    },

    moveWindowClone: function(window, active_index, new_index) {
        if (this.removeWindowActor(this.from, window, new_index)) {
            this.addWindowActor(this.to, window, active_index);
        } //else
        if (this.removeWindowActor(this.from, window, active_index)) {
            this.addWindowActor(this.to, window, new_index);
        } //else
        if (this.removeWindowActor(this.to, window, active_index)) {
            this.addWindowActor(this.from, window, new_index);
        } //else
        if (this.removeWindowActor(this.to, window, new_index)) {
            this.addWindowActor(this.from, window, active_index);
        }
    },

    moveWindow: function(window, direction) {
        if (!window ||
            window.get_window_type() === Meta.WindowType.DESKTOP) return false;

        let active_workspace = global.screen.get_active_workspace();
        let new_workspace = active_workspace.get_neighbor(direction);

        let active_index = active_workspace.index();
        let new_index = new_workspace.index();

        window.change_workspace(new_workspace);
        Mainloop.idle_add(Lang.bind(this, function() {
            // Unless this is done a bit later,
            // window is sometimes not activated
            if (window.get_workspace() ==
                global.screen.get_active_workspace()) {
                window.activate(global.get_current_time());
            }
        }));

        this.moveWindowClone(window, active_index, new_index);
        return true;
    },

    get_workspace_clone_scaled: function(workspaceIndex, direction) {
        let clone = this.get_workspace_clone(workspaceIndex);
        // clone.set_scale(1 - 2*settings.pullaway, 1 - 2*settings.pullaway);
        clone.x = this.monitor.width / 2;
        return clone;
    },

    get_workspace_clone: function(workspaceIndex) {
        let clone = new St.Group({clip_to_allocation: true});
        clone.set_size(this.monitor.width, this.monitor.height);

        let background = new St.Group();
        background.add_actor
            (Meta.BackgroundActor.new_for_screen(global.screen));
        clone.add_actor(background);

        let deskletClone =
            new Clutter.Clone({source : Main.deskletContainer.actor});
        clone.add_actor(deskletClone);

        clone.desktopClones = [];
        global.get_window_actors().forEach(function(w){
            if(w.get_meta_window().get_window_type() ==
               Meta.WindowType.DESKTOP) {
                let texture =
                    w.get_meta_window().get_compositor_private().get_texture();
                let rect = w.get_meta_window().get_input_rect();
                let windowClone = new Clutter.Clone(
                    {source: texture,
                     reactive: true,
                     x: rect.x,
                     y: rect.y,
                    });

                clone.add_actor(windowClone);
                windowClone.lower(deskletClone);
                clone.desktopClones.push(windowClone);
            }
        });

        let workspaceWindows = this.getWorkspaceWindows(workspaceIndex);
        clone.workspaceWindowActors = [];
        for (let i = 0; i < workspaceWindows.length; i++) {
            workspaceWindows[i].i = workspaceWindows[i].get_stable_sequence();
            let windowClone = this.cloneMetaWindow(workspaceWindows[i]);
            clone.add_actor(windowClone);
            clone.workspaceWindowActors.push(windowClone);
        }
        clone.workspaceWindows = workspaceWindows;

        let chromeGroup = new St.Group();
        Main.getPanels().concat(Main.uiGroup.get_children()).forEach(
            function (panel) {
                // Is it a non-autohideable panel, or is it a visible, tracked
                // chrome object? TODO: Make more human-readable the logic
                // below in clone.add_actor().
                if ((panel.actor && !panel._hideable) || (panel &&
                    Main.layoutManager.isTrackingChrome(panel) &&
                    panel.visible)) {
                    let chromeClone = new Clutter.Clone(
                        {source: panel.actor ? panel.actor : panel,
                        x : panel.actor ? panel.actor.x : panel.x,
                        y: panel.actor ? (panel.bottomPosition ?
                        Main.layoutManager.bottomMonitor.y +
                        Main.layoutManager.bottomMonitor.height -
                        panel.actor.height :
                        Main.layoutManager.primaryMonitor.y) : panel.y});
                    chromeGroup.add_actor(chromeClone);
                    chromeClone.raise_top();
                }
            });
        clone.add_actor(chromeGroup);
        chromeGroup.raise_top();
        clone.chromeGroup = chromeGroup;
        clone.index = workspaceIndex;
        return clone;
    },

    cloneMetaWindow: function(metaWindow) {
        let texture =
            metaWindow.get_compositor_private().get_texture();
        let rect = metaWindow.get_input_rect();
        let windowClone = new Clutter.Clone(
            {source: texture,
             reactive: false,
             x: rect.x,
             y: rect.y,
            });
        windowClone.i = metaWindow.i;
        windowClone.win = metaWindow;
        return windowClone;
    },

    getWorkspaceWindows: function(workspaceIndex) {
        let workspaceWindows = [];
        let windows = global.get_window_actors();
        for (let i = 0; i < windows.length; i++) {
            let meta_window = windows[i].get_meta_window();
            if (meta_window.get_workspace().index() == workspaceIndex &&
                !meta_window.minimized &&
                meta_window.get_window_type() !== Meta.WindowType.DESKTOP) {
                workspaceWindows.push(meta_window);
            }
        }

        workspaceWindows.sort(Lang.bind(this, this._sortWindow));
        return workspaceWindows;
    },

    _sortWindow : function(window1, window2) {
        let t1 = window1.get_user_time();
        let t2 = window2.get_user_time();
        if (t2 < t1) {
            return 1;
        } else {
            return -1;
        }
    },

    // I hide the desktop icons for now while rotating until a solution to
    // the artifacts may be found.
    setDesktopClonesVisible: function(workspace_clone, visible) {
        workspace_clone.desktopClones.forEach(Lang.bind(this, function(clone) {
            if (visible)//show
                Tweener.addTween(clone, {
                    opacity: 255,
                    // transition: settings.unrotateEffect,
                    transition: settings.rotateEffect,
                    time: settings.animationTime * 0.3333,
                });
            else//hide
                Tweener.addTween(clone, {
                    opacity: 0,
                    transition: settings.rotateEffect,
                    time: settings.animationTime * 0.3333,
                });
        }));
    },

    startAnimate: function(direction, window) {
      this.is_animating = true;

      // Main.wm.showWorkspaceOSD();
      let active_workspace = global.screen.get_active_workspace();
      let new_workspace = active_workspace.get_neighbor(direction);
      let active_index = active_workspace.index();
      let new_index = new_workspace.index();

      let from_workspace;
      let to_workspace;
      let needScale = false;

      if (this.to != null) {
        from_workspace = this.to;
        needScale = false;
        if (active_workspace.index() == new_workspace.index()) {
          // this.bounce(from_workspace, direction);
          this.from.hide();

          this.unsetIsAnimating();
          return;
        }
      } else {
        from_workspace = this.get_workspace_clone(active_workspace.index());
        this.actor.add_actor(from_workspace);
      }

      if (direction == this.last_direction) {
        if (this.from != null) {
          to_workspace = this.get_workspace_clone
              (new_workspace.index(), direction);
          this.actor.remove_actor(this.from);
          this.from.destroy();
        } else {
          to_workspace = this.get_workspace_clone(new_workspace.index());
        }
        this.actor.add_actor(to_workspace);
      } else {
        to_workspace = this.from;
      }


      this.from = from_workspace;
      this.to = to_workspace;


      this.last_direction = direction;

      this.new_workspace = new_workspace;

      this.prepare(from_workspace, to_workspace, direction, needScale);
    },

    getEasing: function(animationStart) {
      var effect = settings.rotateEffect;
      var dir;

      // CLone code much? Abstract this shit.
      if( effect == "EndBounce" ) {
        effect = (animationStart) ? "easeInCubic" : (this.queued_action) ? "easeOutCubic" : "easeOutBounce";
      } else if( effect == "EndBack" ) {
        effect = (animationStart) ? "easeInCubic" : (this.queued_action) ? "easeOutCubic" : "easeOutBack";
      } else if( effect == "EndElastic" ) {
        effect = (animationStart) ? "easeInCubic" : (this.queued_action) ? "easeOutCubic" : "easeOutElastic";
      } else {
        dir = (animationStart) ? "easeIn" : "easeOut";
        effect = dir + effect;
      }

      return effect;
    },

    getHalfScale: function() {
      return settings.pullaway + (1 - settings.pullaway)/2;
    },

    getScale: function() {
      return settings.pullaway;
    },

    getTime: function() {
      if(this.hurry) {
        return settings.animationTime / 2500;
      }

      return settings.animationTime / 2000;
    },

    prepare: function(from, to, direction, needScale) {
      from.raise_top();
      from.show();
      to.show();

      to.set_scale(1,1);
      from.set_scale(1,1);

      if(settings.transitionEffect == "Flip") {
        this.flip_start(from, to, direction);
      } else if(settings.transitionEffect == "Cube"){
        this.cube_start(from, to, direction);
      } else if(settings.transitionEffect == "Slide"){
        this.slide_start(from, to, direction);
      } else if(settings.transitionEffect == "Deck"){
        this.deck_start(from, to, direction);
      } else if(settings.transitionEffect == "Rolodex"){
        this.rolodex_start(from, to, direction);
      }
    },

    invert: function() {
      return (settings.invert) ? -1 : 1;
    },

    ///////////////////////////////////////////
    // FLIP
    ///////////////////////////////////////////
    flip_end: function(from, to, direction) {
      let angle_from;
      let angle_to;
      let x_pos;

      if (direction == Meta.MotionDirection.LEFT) {
          angle_from = this.const.FLIP_ANGLE;
          angle_to = 0;
          x_pos = this.monitor.width / 2;
      } else {
          angle_from = -this.const.FLIP_ANGLE;
          angle_to = 0;
          x_pos = this.monitor.width / 2;
      }

      Tweener.addTween(to, {
          x: x_pos,
          opacity: 255,
          scale_x: 1.0,
          scale_y: 1.0,
          rotation_angle_y: angle_to,
          transition: this.getEasing(false),
          time: this.getTime(),
          onComplete: this.unsetIsAnimating,
          onCompleteScope: this
      });

      from.hide();
      to.show();
      this.new_workspace.activate(global.get_current_time());
      Main.wm.showWorkspaceOSD();
    },

    flip_start: function(from, to, direction) {
      let angle_from;
      let angle_to;
      let x_pos;

      to.hide();

      if (direction == Meta.MotionDirection.LEFT) {
        angle_from = this.const.FLIP_ANGLE;
        angle_to = 0;
        x_pos = this.monitor.width / 2;

        from.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);
        to.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);

        from.set_position(x_pos, this.monitor.height/2);
        to.set_position(x_pos, this.monitor.height/2);
      } else {
        angle_from = -this.const.FLIP_ANGLE;
        angle_to = 0;
        x_pos = this.monitor.width / 2;

        from.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);
        to.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);

        from.set_position(x_pos, this.monitor.height/2);
        to.set_position(x_pos, this.monitor.height/2);
      }

      Tweener.addTween(from, {
          x: x_pos,
          scale_x: settings.pullaway,
          scale_y: settings.pullaway,
          opacity: 255 * (1.0 - settings.fade),
          rotation_angle_y: angle_from/2,
          transition: this.getEasing(true),
          time: this.getTime(),
      });

      Tweener.addTween(to, {
          x: x_pos,
          opacity: 255 * (1.0 - settings.fade),
          scale_x: settings.pullaway,
          scale_y: settings.pullaway,
          rotation_angle_y: -angle_from/2,
          transition: this.getEasing(true),
          time: this.getTime(),
          onCompleteParams: [from, to, direction],
          onComplete: this.flip_end,
          onCompleteScope: this,
      });
    },

    ///////////////////////////////////////////
    // SLIDE
    ///////////////////////////////////////////
    slide_end: function(from, to, direction) {
      let toTransition;
      let fromTransition;
      to.raise_top();
      this.new_workspace.activate(global.get_current_time());

      if (direction == Meta.MotionDirection.LEFT) {
        fromTransition = this.monitor.width;
      } else {
        fromTransition = -this.monitor.width;
      }

      Tweener.addTween(from, {
          x: fromTransition,
          scale_x: this.getScale(),
          scale_y: this.getScale(),
          opacity: 255 * (1.0 - settings.fade),
          transition: this.getEasing(false),
          time: this.getTime(),
      });

      Tweener.addTween(to, {
          x: 0,
          opacity: 255,
          scale_x: 1.0,
          scale_y: 1.0,
          transition: this.getEasing(false),
          time: this.getTime(),
          onComplete: this.unsetIsAnimating,
          onCompleteScope: this
      });

      Main.wm.showWorkspaceOSD();
    },

    slide_start: function(from, to, direction) {
      to.raise_top();

      from.move_anchor_point_from_gravity(Clutter.Gravity.WEST);
      to.move_anchor_point_from_gravity(Clutter.Gravity.WEST);

      let toTransition;
      let fromTransition;

      if (direction == Meta.MotionDirection.LEFT) {
        from.set_position(0, this.monitor.height/2);
        from.rotation_angle_y = 0

        to.set_position(-this.monitor.width, this.monitor.height/2);
        to.rotation_angle_y = 0

        toTransition = -this.monitor.width/2;
        fromTransition = this.monitor.width/2;
      } else {
        from.set_position(0, this.monitor.height/2);
        from.rotation_angle_y = 0

        to.set_position(this.monitor.width, this.monitor.height/2);
        to.rotation_angle_y = 0

        toTransition = this.monitor.width/2;
        fromTransition = -this.monitor.width/2;
      }

      from.set_scale(1,1);
      to.set_scale(settings.pullaway, settings.pullaway);

      Tweener.addTween(from, {
          x: fromTransition,
          scale_x: this.getHalfScale(),
          scale_y: this.getHalfScale(),
          opacity: 255 * (1.0 - settings.fade),
          transition: this.getEasing(true),
          time: this.getTime(),
      });

      Tweener.addTween(to, {
          x: toTransition,
          opacity: 255 * (1.0 - settings.fade),
          scale_x: this.getHalfScale(),
          scale_y: this.getHalfScale(),
          transition: this.getEasing(true),
          time: this.getTime(),
          onCompleteParams: [from, to, direction],
          onComplete: this.slide_end,
          onCompleteScope: this,
      });
    },

    ///////////////////////////////////////////
    // DECK
    ///////////////////////////////////////////
    deck_end: function(from, to, direction) {
      let toTransition;
      let fromTransition;
      this.new_workspace.activate(global.get_current_time());

      if (direction == Meta.MotionDirection.LEFT) {
        Tweener.addTween(to, {
            x: 0,
            y: this.monitor.height/2,
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            transition: this.getEasing(false),
            rotation_angle_y: 0,
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
      } else {
        Tweener.addTween(from, {
            x: -this.monitor.width,
            brightness: 1.0,
            scale_x: this.getScale(),
            scale_y: this.getScale(),
            opacity: 255 * (1.0 - settings.fade),
            transition: this.getEasing(false),
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
      }

      Main.wm.showWorkspaceOSD();
    },

    deck_start: function(from, to, direction) {
      from.move_anchor_point_from_gravity(Clutter.Gravity.WEST);
      to.move_anchor_point_from_gravity(Clutter.Gravity.WEST);

      let toTransition;
      let fromTransition;

      if (direction == Meta.MotionDirection.LEFT) {
        to.raise_top();
        from.set_position(0, this.monitor.height/2 );
        from.rotation_angle_y = 0;

        to.set_position(-this.monitor.width, this.monitor.height/2 - this.const.DECK_HEIGHT);
        to.rotation_angle_y = -this.const.DECK_ANGLE;

        toTransition = -this.monitor.width/2;
        to.set_scale(this.getScale(), this.getScale());

        Tweener.addTween(to, {
            x: toTransition,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.getHalfScale(),
            scale_y: this.getHalfScale(),
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.deck_end,
            onCompleteScope: this
        });
      } else {
        from.set_position(0, this.monitor.height/2);
        from.rotation_angle_y = 0

        to.set_position(0, this.monitor.height/2);
        to.rotation_angle_y = 0

        fromTransition = -this.monitor.width/2;
        Tweener.addTween(from, {
            x: fromTransition,
            y: this.monitor.height/2 - this.const.DECK_HEIGHT,
            scale_x: this.getHalfScale(),
            scale_y: this.getHalfScale(),
            rotation_angle_y: -this.const.DECK_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.deck_end,
            onCompleteScope: this
        });
      }
    },

    ///////////////////////////////////////////
    // CUBE
    ///////////////////////////////////////////
    cube_end: function(from, to, direction) {
      let toTransition;
      let fromTransition;
      this.new_workspace.activate(global.get_current_time());
      to.raise_top();

      if (direction == Meta.MotionDirection.RIGHT) {
        Tweener.addTween(to, {
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            transition: this.getEasing(false),
            rotation_angle_y: 0,
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
        Tweener.addTween(from, {
            // x: -this.monitor.width,
            opacity: settings.fade,
            scale_x: this.const.CUBE_ZOOM,
            scale_y: this.const.CUBE_ZOOM,
            transition: this.getEasing(false),
            rotation_angle_y: this.const.CUBE_FULL_ANGLE
        });
      } else {
        Tweener.addTween(to, {
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            transition: this.getEasing(false),
            rotation_angle_y: 0,
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
        Tweener.addTween(from, {
            opacity: settings.fade,
            scale_x: this.const.CUBE_ZOOM,
            scale_y: this.const.CUBE_ZOOM,
            transition: this.getEasing(false),
            rotation_angle_y: -this.const.CUBE_FULL_ANGLE
        });
      }

      Main.wm.showWorkspaceOSD();
    },

    cube_start: function(from, to, direction) {
      let toTransition;
      let fromTransition;

      from.show();
      to.show();

      if (direction == Meta.MotionDirection.RIGHT) {
        from.move_anchor_point_from_gravity(Clutter.Gravity.WEST);
        to.move_anchor_point_from_gravity(Clutter.Gravity.EAST);

        from.raise_top();
        from.set_position(0, this.monitor.height/2 );
        from.rotation_angle_y = 0;

        to.set_position(this.monitor.width, this.monitor.height/2);
        to.rotation_angle_y = this.const.CUBE_START_ANGLE;
        to.set_scale(this.const.CUBE_ZOOM, this.const.CUBE_ZOOM);
        to.set_opacity(settings.fade);

        toTransition = this.monitor.width/2;

        Tweener.addTween(from, {
            rotation_angle_y: -this.const.CUBE_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.const.CUBE_HALF_ZOOM,
            scale_y: this.const.CUBE_HALF_ZOOM,
            transition: this.getEasing(true),
            time: this.getTime(),
        });

        Tweener.addTween(to, {
            rotation_angle_y: this.const.CUBE_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.const.CUBE_HALF_ZOOM,
            scale_y: this.const.CUBE_HALF_ZOOM,
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.cube_end,
            onCompleteScope: this
        });
      } else {
        from.move_anchor_point_from_gravity(Clutter.Gravity.EAST);
        to.move_anchor_point_from_gravity(Clutter.Gravity.WEST);

        from.raise_top();
        from.set_position(this.monitor.width, this.monitor.height/2 );
        from.rotation_angle_y = 0;

        to.set_position(0, this.monitor.height/2);
        to.rotation_angle_y = -this.const.CUBE_START_ANGLE;
        to.set_scale(this.const.CUBE_ZOOM, this.const.CUBE_ZOOM);
        to.set_opacity(settings.fade);

        toTransition = -this.monitor.width/2;

        Tweener.addTween(from, {
            rotation_angle_y: this.const.CUBE_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.const.CUBE_HALF_ZOOM,
            scale_y: this.const.CUBE_HALF_ZOOM,
            transition: this.getEasing(true),
            time: this.getTime(),
        });

        Tweener.addTween(to, {
            rotation_angle_y: -this.const.CUBE_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.const.CUBE_HALF_ZOOM,
            scale_y: this.const.CUBE_HALF_ZOOM,
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.cube_end,
            onCompleteScope: this
        });
      }
    },

    ///////////////////////////////////////////
    // ROLODEX
    ///////////////////////////////////////////
    rolodex_end: function(from, to, direction) {
      let toTransition;
      let fromTransition;
      this.new_workspace.activate(global.get_current_time());


      if (direction == Meta.MotionDirection.LEFT) {
        Tweener.addTween(to, {
            rotation_angle_y: 0,
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            transition: this.getEasing(false),
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
      } else {
        Tweener.addTween(from, {
            scale_x: this.getScale(),
            scale_y: this.getScale(),
            rotation_angle_y: -this.const.ROLODEX_FULL_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            transition: this.getEasing(false),
            time: this.getTime(),
            onComplete: this.unsetIsAnimating,
            onCompleteScope: this
        });
      }

      Main.wm.showWorkspaceOSD();
    },

    rolodex_start: function(from, to, direction) {
      let toTransition;
      let fromTransition;

      from.move_anchor_point_from_gravity(Clutter.Gravity.WEST);
      to.move_anchor_point_from_gravity(Clutter.Gravity.WEST);


      if (direction == Meta.MotionDirection.LEFT) {
        to.raise_top();
        from.set_position(0, this.monitor.height/2 );
        from.rotation_angle_y = 0;

        to.set_position(0, this.monitor.height/2);
        to.rotation_angle_y = -this.const.ROLODEX_FULL_ANGLE;
        to.set_opacity = settings.fade;

        to.set_scale(this.getScale(), this.getScale());

        Tweener.addTween(to, {
            rotation_angle_y: -this.const.ROLODEX_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            scale_x: this.getHalfScale(),
            scale_y: this.getHalfScale(),
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.rolodex_end,
            onCompleteScope: this
        });
      } else {
        from.set_position(0, this.monitor.height/2);
        from.rotation_angle_y = 0;

        to.set_position(0, this.monitor.height/2);
        to.rotation_angle_y = 0;

        Tweener.addTween(from, {
            scale_x: this.getHalfScale(),
            scale_y: this.getHalfScale(),
            rotation_angle_y: -this.const.ROLODEX_HALF_ANGLE,
            opacity: 255 * (1.0 - settings.fade),
            transition: this.getEasing(true),
            time: this.getTime(),
            onCompleteParams: [from, to, direction],
            onComplete: this.rolodex_end,
            onCompleteScope: this
        });
      }
    },

    unsetIsAnimating: function() {
      this.from.hide();
      this.is_animating = false;


      if( this.queued_action ){
        let action = this.queued_action;
        this.queued_action = null;
        this.processKeypress( action );
      } else if( this.destroy_requested ) {
        this.onDestroy();
      }
    },

    processKeypress: function(action) {
      let workspace;
      let windows;
      let window;

      switch(action) {
        case Meta.KeyBindingAction.MOVE_TO_WORKSPACE_LEFT:
          this.direction = Meta.MotionDirection.LEFT;
          workspace = global.screen.get_active_workspace().index();
          windows = this.getWorkspaceWindows(workspace);
          this.startAnimate(this.direction, window);
          break;

        case Meta.KeyBindingAction.MOVE_TO_WORKSPACE_RIGHT:
          this.direction = Meta.MotionDirection.RIGHT;
          workspace = global.screen.get_active_workspace().index();
          windows = this.getWorkspaceWindows(workspace);
          this.startAnimate(this.direction, window);
          break;

        case Meta.KeyBindingAction.WORKSPACE_LEFT:
          this.direction = Meta.MotionDirection.LEFT;
          this.startAnimate(this.direction);
          break;

        case Meta.KeyBindingAction.WORKSPACE_RIGHT:
          this.direction = Meta.MotionDirection.RIGHT;
          this.startAnimate(this.direction);
          break;
      }
    },

    _keyPressEvent: function(actor, event) {
      // Make sure we don't accidentally destroy the scene
      this.destroy_requested = false;

      let event_state = Cinnamon.get_event_state(event);
      if (this.is_animating) {
        this.hurry = true;
        this.queued_action = global.display.get_keybinding_action(event.get_key_code(), event_state);
      } else {
        this.hurry = false;
        let action = global.display.get_keybinding_action(event.get_key_code(), event_state);

        this.processKeypress(action);
      }

      return true;
    },

    _keyReleaseEvent: function(actor, event) {
        let [_, _, mods] = global.get_pointer();
        let state = mods & this._modifierMask;


        if (state == 0) {
          if (this.is_animating) {
            this.destroy_requested = true;
          } else {
            this.destroy_requested = true;
            this.onDestroy();
          }
        }

        return true;
    },

    initBackground: function() {
        this._backgroundGroup = new St.Group({});
        Main.uiGroup.add_actor(this._backgroundGroup);
        this._backgroundGroup.hide();
        this._backgroundGroup.add_actor
            (Meta.BackgroundActor.new_for_screen(global.screen));
        this._backgroundGroup.raise_top();
        this._backgroundGroup.lower(this.actor);
    },

    dimBackground: function() {
        this._backgroundGroup.show();
        let background = this._backgroundGroup.get_children()[0];
        Tweener.addTween(background, {
            dim_factor: 0.0,
            time: settings.animationTime*0,
            transition: 'easeOutQuad'
        });
    },

    onDestroy: function() {
      this.destroy();
      this.destroy_requested = false;
    },

    destroy: function() {
      Main.uiGroup.remove_actor(this._backgroundGroup);
      Main.uiGroup.remove_actor(this.actor);

      Main.getPanels().forEach(function(panel){panel.actor.opacity = 255;});
      global.window_group.show();
      this.actor.destroy();
    }

};

function onSwitch(display, screen, window, binding) {
    new Flipper(display, screen, window, binding);
}

function FlipperSettings(uuid) {
    this._init(uuid);
}

FlipperSettings.prototype = {
    _init: function(uuid) {
        this.settings = new Settings.ExtensionSettings(this, uuid);
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "animationTime", "animationTime", function(){});
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "pullaway", "pullaway", function(){});
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "fade", "fade", function(){});
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "rotateEffect", "rotateEffect", function(){});
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "transitionEffect", "transitionEffect", function(){});
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "invert", "invert", function(){});
        // this.settings.bindProperty(Settings.BindingDirection.IN,
        //     "easeDirection", "easeDirection", function(){});
    }
}

function init(metadata) {
    settings = new FlipperSettings(metadata.uuid);
}

function enable() {
    for (let i in bindings) {
        Meta.keybindings_set_custom_handler(bindings[i],
            Lang.bind(this, onSwitch));
    }
}

function disable() {
    Meta.keybindings_set_custom_handler('switch-to-workspace-left',
        Lang.bind(Main.wm, Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler('switch-to-workspace-right',
        Lang.bind(Main.wm, Main.wm._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler('move-to-workspace-left',
        Lang.bind(Main.wm, Main.wm._moveWindowToWorkspaceLeft));
    Meta.keybindings_set_custom_handler('move-to-workspace-right',
        Lang.bind(Main.wm, Main.wm._moveWindowToWorkspaceRight));
}
