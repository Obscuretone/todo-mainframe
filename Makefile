.PHONY: cobol install check run clean

cobol:
	mkdir -p bin data
	cobc -x -free -o bin/todostore cobol/todostore.cbl

install:
	npm install

check:
	npm run check

run: cobol
	npm start

clean:
	rm -rf bin/todostore data/*.isam data/*.idx data/*.dat
