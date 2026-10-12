/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import publicWidget from "@theme_scita/js/compat/public_widget";
import { countdownParts, renderCountdown } from "@theme_scita/js/countdown_dom";

function timerMarkup([days, hours, minutes, seconds]) {
    return "<div class='counter_timer_div'><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'><div class='box_degit'><span id='days' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+	days +"</span><span id='day_lbl' class='d-block'>DAYS</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'><div class='box_degit'><span id='hours' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+hours+"</span><span id='h_lbl' class='d-block'>HOURS</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'><div class='box_degit'><span id='minutes' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+minutes+"</span><span id='m_lbl' class=' d-block'>MINS</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'><div class='box_degit'><span id='seconds' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+seconds+"</span><span id='s_lbl' class='d-block'>SECS</span></div></span></div>";
}
  
//   animation.registry.js_counter_timer = animation.Class.extend({
	publicWidget.registry.js_counter_timer = publicWidget.Widget.extend({

    selector : ".js_counter_timer",
    disabledInEditableMode: true,
    start: function(){
        this.redrow();
      },
      stop: function(){
        this.clean();
      },
      destroy: function(){
        // the compat layer tears widgets down with destroy(), not stop()
        clearInterval(this._timerInterval);
        return this._super.apply(this, arguments);
      },

      redrow: function(debug){
        this.clean(debug);
        this.build(debug);
      },

      clean:function(debug){
        clearInterval(this._timerInterval);
        this.$target.empty();
      },
      build: function(debug)
      {
    	  var self = this;
    	  var date = self.$target.data("date");
    	  if (date == "nan") {
    		  return;
    	  }
    	  var toDate = new Date(date).getTime();
    	  if (isNaN(toDate)) {
    		  return; // no / invalid date: nothing to count down to
    	  }
    	  var tick = function () {
    		  var parts = countdownParts(toDate);
    		  if (!parts) {
    			  // the count down is over: show 00s and the message
    			  clearInterval(self._timerInterval);
    			  parts = ["00", "00", "00", "00"];
    			  self.$target.addClass("time_out");
    			  self.$target.append("<div class='time_over_msg'><p>"+self.$target.data("msg")+"</p></div>");
    		  } else {
    			  self.$target.removeClass("time_out");
    		  }
    		  renderCountdown(self.el, parts, timerMarkup);
    	  };
    	  // first draw right away (it used to appear after 1s and push the page down)
    	  self._timerInterval = setInterval(tick, 1000);
    	  tick();
      }
  });
			
