window.Mouse = {};
Mouse.init = function(target){

	// Events!
	var _onmousedown = function(event){
		Mouse.moved = false;
		Mouse.pressed = true;
		Mouse.startedOnTarget = true;
		publish("mousedown");
	};

	var _ondoubleclick = function(event){
		Mouse.moved = false;
		Mouse.pressed = true;
		Mouse.startedOnTarget = true;
		publish("dblclick");
	};

	var _onmousewheel = function(event){
		publish("wheel",[event]);
	};

	var _onmousemove = function(event){

		// Raw CSS-space coords (needed for panning, which modifies the transform itself)
		Mouse.rawX = event.x;
		Mouse.rawY = event.y;

		// Inverse of drawing transform: ctx.translate(offsetX, offsetY) then ctx.scale(scale, scale)
		// Drawing uses retina (2x) coords: retina_pos = offsetX + scale * (world * 2)
		// CSS = retina / 2, so: css = offsetX/2 + scale * world
		// Therefore: world = (css - offsetX/2) / scale
		Mouse.x = (event.x - loopy.offsetX / 2) / loopy.offsetScale;
		Mouse.y = (event.y - loopy.offsetY / 2) / loopy.offsetScale;

		Mouse.moved = true;
		publish("mousemove");

	};
	var _onmouseup = function(){
		Mouse.pressed = false;
		if(Mouse.startedOnTarget){
			publish("mouseup");
			if(!Mouse.moved) publish("mouseclick");
		}
		Mouse.moved = false;
		Mouse.startedOnTarget = false;
	};

	// Add mouse & touch events!
	_addMouseEvents(target, _onmousedown, _onmousemove, _onmouseup, _onmousewheel, _ondoubleclick);

	// Cursor & Update
	Mouse.target = target;
	Mouse.showCursor = function(cursor){
		Mouse.target.style.cursor = cursor;
	};
	Mouse.update = function(){
		Mouse.showCursor("");
	};

};