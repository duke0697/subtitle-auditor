Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 0
$synth.SetOutputToWaveFile('D:\zhxl\code\test\ASR\tests\fixtures\s1.wav')
$synth.Speak('今天天气很好我们出去走走吧')
$synth.SetOutputToWaveFile('D:\zhxl\code\test\ASR\tests\fixtures\s2.wav')
$synth.Speak('好呀我想去公园看看')
$synth.Dispose()
Write-Output 'tts done'
