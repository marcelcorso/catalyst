# catalyst


## Connect to the remote debugger

 * download webkit nightly 
 * open http://192.168.192.30:9998/ on it

## Run it on your computs to test if the javascripts dont break 

```
sudo service tomcat6 stop # :P
python -m SimpleHTTPServer 8080
```

## Deploy to the py

```
scp * root@192.168.192.12:/boot/www/
echo "/etc/init.d/S90wpe restart" | ssh root@192.168.192.12
```

