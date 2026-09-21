# Monochrome illustration series

Generated using the built-in imagegen tool. All ten final assets are saved under `src/assets/illustrations/` with the filenames below. Each final prompt is the shared prefix followed by `Scene: ` and the corresponding scene text.

The cast was deliberately designed to include white, Black, East Asian, South Asian, Latino, and Arab characters with varied grayscale skin tones, hair textures, facial features, and genders. These are fictional character design directions, not identity inferences. Recurring characters connect related scenes.

## Shared prompt

Use case: illustration-story. Create one production illustration for an app, part of a cohesive ethnically diverse cast. Friendly minimal monochrome editorial doodle like a simple person at a laptop: rounded organic black ink contours, flat fills, expressive dark eyes, subtle nose and gentle smile, casual everyday clothing. Preserve a variety of light, medium and deep GRAYSCALE skin tones, natural hair textures and facial features; never make every face white. Respectful individual people, no ethnic caricature, no cultural costume or symbolic ethnic props. Skin tone consistent on face, neck, hands. Hair and eyes darker than skin, readable natural facial contrast even for deep skin; no white glowing eyes. Flat black/white/gray artwork only, no color, gradients, 3D, glow, haze, halos, or shadows outside objects. Truly transparent background, no backdrop rectangle, no text or logos or watermark. Entire scene centered in a landscape 3:2 frame with 10% clear margins, readable at 300px wide.

## Scene prompts

### login-waiting.png

A young white man with light gray skin, short softly tousled dark hair and a casual crewneck. At an open laptop, resting chin on one hand while patiently waiting, with a small clock beside the laptop. Calm friendly expression.

### login-success.png

A young white woman with light gray skin, shoulder-length wavy dark hair and a casual crewneck. Behind an open laptop, giving a modest thumbs-up, with a small checkmark inside a circle above the laptop. Gentle pleased smile.

### login-failure.png

A young East Asian man with light-medium gray skin, straight dark hair with a soft side part, naturally shaped eyes and a casual charcoal crewneck. At an open laptop, hand gently touching the back of his head, mildly puzzled but hopeful, with a disconnected plug beside the laptop. Reassuring retry moment, no tears or alarm.

### login-sharing.png

Two friendly collaborators side by side at one laptop: a Black woman with deep gray skin and natural coily hair in a rounded puff, and an East Asian man with light-medium gray skin and straight side-parted dark hair. One points to the screen and the other holds a small document. Equal prominence and engaged expressions, casual crewnecks.

### login-market.png

A young South Asian woman with medium-dark gray skin, dark almond-shaped eyes and thick wavy shoulder-length hair, wearing a casual light-gray shirt. At a laptop arranging three small rounded tool cards with simple geometric icons, discovering useful tools.

### login-mobile-remote.png

A young Latino man with medium gray skin, short loose dark curls and a casual light-gray crewneck. Holding a smartphone beside an open laptop with a simple dotted curved connection between devices. Friendly relaxed expression, devices clearly visible.

### onboarding.png

A young South Asian woman with medium-dark gray skin, dark almond-shaped eyes and thick wavy shoulder-length hair, wearing a casual light-gray shirt. At an open laptop, welcoming with an open palm toward three simple stepping-stone cards for ideas, learning and completion. Inviting and calm.

### quit.png

A young Latino man with medium gray skin, short loose dark curls and a casual light-gray crewneck. Packing a closed laptop into a shoulder bag beside a small desk with a mug. Calmly finishing work, gentle smile, no waving gesture.

### update.png

A young East Asian man with light-medium gray skin, straight dark hair with a soft side part, naturally shaped eyes and a casual charcoal crewneck. At an open laptop, hands resting calmly on a simple desk, small upward arrow inside a circle above the screen. Reassuring software update scene.

### sign-out.png

A young Arab woman with medium gray skin, softly arched brows and dark wavy hair loosely tied back, wearing a casual light-gray crewneck. Behind a closed laptop on a simple desk, smiling gently and raising one hand in a goodbye wave. Small coffee mug beside laptop, two tiny wave marks. Friendly natural face.

## Theme treatment

`src/components/Illustration/` retains the shared decorative semantics, contain fitting, and app-theme CSS. Light mode uses multiply blending; dark mode uses normal blending with brightness 0.96 and contrast 0.8. This preserves the ordering of skin tones and dark facial features without inversion. Generated alpha is preserved. Login videos remain unchanged. In-app visual verification has not been performed.
