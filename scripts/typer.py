import sys
import time

try:
    import pyperclip
    import keyboard
except ImportError:
    print("Missing modules: pyperclip or keyboard")
    sys.exit(1)

def type_clipboard():
    text = pyperclip.paste()
    if not text:
        return

    # Delay to ensure the modifier keys (Ctrl+Shift+V) are released before typing starts
    # Otherwise pyautogui might try to type while Ctrl is still held down!
    time.sleep(0.3) 
    
    for char in text:
        if char == '\n':
            keyboard.send('enter')
            time.sleep(0.05)
        elif char == '\t':
            keyboard.send('tab')
            time.sleep(0.05)
        elif char == '\r':
            pass # ignore carriage return to avoid double enters
        else:
            keyboard.write(char, exact=True)
            time.sleep(0.02)

if __name__ == "__main__":
    type_clipboard()
