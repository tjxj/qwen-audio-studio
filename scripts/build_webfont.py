"""Build the optional OFL webfont from a locally supplied Source Han Serif VF.

uv run --with fonttools --with brotli python scripts/build_webfont.py INPUT.ttf
The subset is renamed so it does not use Adobe's reserved primary font name.
"""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

parser=argparse.ArgumentParser()
parser.add_argument('input',type=Path)
args=parser.parse_args()
font=TTFont(args.input)
options=subset.Options()
options.flavor='woff2'
options.name_IDs=['*']
options.name_languages=['*']
subsetter=subset.Subsetter(options=options)
subsetter.populate(unicodes=list(range(0x20,0x100))+list(range(0x2000,0x2070))+list(range(0x3000,0x3040))+list(range(0x3400,0xA000))+list(range(0xFF00,0xFFF0)))
subsetter.subset(font)
for record in font['name'].names:
    names={1:'Studio Han Serif',3:'Studio Han Serif VF subset 1',4:'Studio Han Serif Variable',6:'StudioHanSerifVF',16:'Studio Han Serif',21:'Studio Han Serif',25:'StudioHanSerifVF'}
    if record.nameID in names:
        record.string=names[record.nameID].encode(record.getEncoding())
font.flavor='woff2'
target=Path(__file__).resolve().parents[1]/'frontend/public/fonts/studio-han-serif.woff2'
target.parent.mkdir(parents=True,exist_ok=True)
font.save(target)
print(f'Webfont built: {target.name}, {target.stat().st_size} bytes')
