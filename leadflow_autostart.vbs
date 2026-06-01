Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run "cmd /c cd /d ""E:\lead flow 2\Leadflow\"" && node leadflow_node_server.js", 0, False 
