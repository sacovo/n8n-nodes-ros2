# Battery state of the demo rover.
# Published at 1 Hz on /rover/battery.

# Remaining charge in percent, 0.0 - 100.0
float32 percentage

# Pack voltage in volts. Modelled as 22.2 V nominal, sagging with charge.
float32 voltage

# True while the rover sits on the dock and is gaining charge.
bool charging

# Estimated seconds of driving left at the current draw. -1.0 while charging.
float32 seconds_remaining
