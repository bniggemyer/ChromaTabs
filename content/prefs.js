var Chromatabs_pref = {

	base_preset_change: function() { 
		var setting = document.getElementById("basePresetDropdown").value;

		switch (parseInt(setting)){
			case 1: // firefox 4 blue 
				Chromatabs_pref.apply_preset(227,237,246,100);
				break;
			case 2: // solid white
				Chromatabs_pref.apply_preset(255,255,255,100);
				break;
			case 3: // solid black
				Chromatabs_pref.apply_preset(0,0,0,100);
				break;
			case 4: // transparent
				Chromatabs_pref.apply_preset(0,0,0,0);
				break;
			case 5: // manual
				Chromatabs_pref.disable_base_prefs(false);
				break;
		}

	},
	
	apply_preset: function(r, g, b, o){
		Chromatabs_pref.disable_base_prefs(true);
		document.getElementById("baseRed").value = r;
		document.getElementById("baseGreen").value = g;
		document.getElementById("baseBlue").value = b;
		document.getElementById("baseOpacity").value = o;
	},
	
	disable_base_prefs: function(is_disabled) { 
		document.getElementById("baseRed").disabled=is_disabled;
		document.getElementById("baseGreen").disabled=is_disabled;
		document.getElementById("baseBlue").disabled=is_disabled;
		document.getElementById("baseOpacity").disabled=is_disabled;
	}, 
  
	load_preferences: function(){
		Chromatabs_pref.base_preset_change();  
	}
}

