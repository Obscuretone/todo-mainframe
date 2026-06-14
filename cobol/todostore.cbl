       IDENTIFICATION DIVISION.
       PROGRAM-ID. TODOSTORE.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT DB-FILE ASSIGN TO DYNAMIC DB-FILE-NAME
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS DB-KEY
               FILE STATUS IS FILE-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD DB-FILE.
       01 DB-RECORD.
          05 DB-KEY        PIC X(24).
          05 DB-PARENT     PIC X(24).
          05 DB-SEGMENT    PIC X(8).
          05 TODO-ID       PIC X(8).
          05 TODO-STATUS   PIC X(12).
          05 TODO-CREATED  PIC X(14).
          05 TODO-UPDATED  PIC X(14).
          05 TODO-TITLE    PIC X(160).

       WORKING-STORAGE SECTION.
       01 FILE-STATUS      PIC XX.
       01 DB-FILE-NAME     PIC X(255) VALUE "data/todo-ims.db".
       01 ARG-COUNT        PIC 9(4).
       01 OPERATION        PIC X(12).
       01 INPUT-ID         PIC X(8).
       01 INPUT-STATUS     PIC X(12).
       01 INPUT-TITLE      PIC X(160).
       01 CURRENT-DAY      PIC X(8).
       01 CURRENT-CLOCK    PIC X(8).
       01 CURRENT-STAMP    PIC X(14).
       01 GENERATED-ID     PIC X(8).
       01 BUSINESS-ERROR   PIC X VALUE "N".

       PROCEDURE DIVISION.
       MAIN.
           ACCEPT ARG-COUNT FROM ARGUMENT-NUMBER
           IF ARG-COUNT < 1
               PERFORM FAIL-USAGE
           ELSE
               ACCEPT OPERATION FROM ARGUMENT-VALUE
               PERFORM OPEN-STORE
               IF BUSINESS-ERROR = "N"
                   PERFORM DISPATCH-OPERATION
                   CLOSE DB-FILE
               END-IF
           END-IF
           GOBACK.

       DISPATCH-OPERATION.
           EVALUATE FUNCTION TRIM(OPERATION)
               WHEN "LIST"
                   PERFORM LIST-TODOS
               WHEN "GET"
                   PERFORM READ-ARGS-ID
                   PERFORM VALIDATE-ID
                   IF BUSINESS-ERROR = "N"
                       PERFORM GET-TODO
                   END-IF
               WHEN "CREATE"
                   PERFORM READ-ARGS-CREATE
                   PERFORM CREATE-TODO
               WHEN "UPDATE"
                   PERFORM READ-ARGS-UPDATE
                   PERFORM UPDATE-TODO
               WHEN "SETSTATUS"
                   PERFORM READ-ARGS-STATUS
                   PERFORM SET-TODO-STATUS
               WHEN "DELETE"
                   PERFORM READ-ARGS-ID
                   PERFORM VALIDATE-ID
                   IF BUSINESS-ERROR = "N"
                       PERFORM DELETE-TODO
                   END-IF
               WHEN OTHER
                   PERFORM FAIL-UNKNOWN
           END-EVALUATE.

       OPEN-STORE.
           OPEN I-O DB-FILE
           IF FILE-STATUS = "35"
               OPEN OUTPUT DB-FILE
               PERFORM WRITE-ROOT-SEGMENT
               CLOSE DB-FILE
               OPEN I-O DB-FILE
           END-IF
           IF FILE-STATUS NOT = "00"
               DISPLAY "ERR|cannot open IMS database|" FILE-STATUS
               MOVE "Y" TO BUSINESS-ERROR
               MOVE 1 TO RETURN-CODE
           END-IF.

       WRITE-ROOT-SEGMENT.
           MOVE "ROOT:TODO-70" TO DB-KEY
           MOVE SPACES TO DB-PARENT
           MOVE "ROOT" TO DB-SEGMENT
           MOVE SPACES TO TODO-ID
           MOVE SPACES TO TODO-STATUS
           MOVE SPACES TO TODO-CREATED
           MOVE SPACES TO TODO-UPDATED
           MOVE "TODO-70 IMS ROOT" TO TODO-TITLE
           WRITE DB-RECORD
               INVALID KEY
                   CONTINUE
           END-WRITE.

       READ-ARGS-ID.
           ACCEPT INPUT-ID FROM ARGUMENT-VALUE.

       READ-ARGS-CREATE.
           ACCEPT INPUT-STATUS FROM ARGUMENT-VALUE
           ACCEPT INPUT-TITLE FROM ARGUMENT-VALUE.

       READ-ARGS-UPDATE.
           ACCEPT INPUT-ID FROM ARGUMENT-VALUE
           ACCEPT INPUT-STATUS FROM ARGUMENT-VALUE
           ACCEPT INPUT-TITLE FROM ARGUMENT-VALUE.

       READ-ARGS-STATUS.
           ACCEPT INPUT-ID FROM ARGUMENT-VALUE
           ACCEPT INPUT-STATUS FROM ARGUMENT-VALUE.

       CREATE-TODO.
           PERFORM PREPARE-BUSINESS-FIELDS
           IF BUSINESS-ERROR = "N"
               PERFORM GENERATE-ID
               MOVE GENERATED-ID TO INPUT-ID
               PERFORM SET-TODO-KEY
               MOVE GENERATED-ID TO TODO-ID
               MOVE "ROOT:TODO-70" TO DB-PARENT
               MOVE "TODO" TO DB-SEGMENT
               MOVE INPUT-STATUS TO TODO-STATUS
               MOVE CURRENT-STAMP TO TODO-CREATED
               MOVE CURRENT-STAMP TO TODO-UPDATED
               MOVE INPUT-TITLE TO TODO-TITLE
               WRITE DB-RECORD
                   INVALID KEY
                       DISPLAY "ERR|generated duplicate id; retry create"
                       MOVE "Y" TO BUSINESS-ERROR
                       MOVE 1 TO RETURN-CODE
                   NOT INVALID KEY
                       PERFORM EMIT-TODO
               END-WRITE
           END-IF.

       GET-TODO.
           PERFORM SET-TODO-KEY
           READ DB-FILE KEY IS DB-KEY
               INVALID KEY
                   PERFORM FAIL-NOT-FOUND
               NOT INVALID KEY
                   PERFORM EMIT-TODO
           END-READ.

       UPDATE-TODO.
           PERFORM VALIDATE-ID
           PERFORM PREPARE-BUSINESS-FIELDS
           IF BUSINESS-ERROR = "N"
               PERFORM SET-TODO-KEY
               READ DB-FILE KEY IS DB-KEY
                   INVALID KEY
                       PERFORM FAIL-NOT-FOUND
                   NOT INVALID KEY
                       MOVE INPUT-STATUS TO TODO-STATUS
                       MOVE CURRENT-STAMP TO TODO-UPDATED
                       MOVE INPUT-TITLE TO TODO-TITLE
                       REWRITE DB-RECORD
                           INVALID KEY
                               DISPLAY "ERR|rewrite failed"
                               MOVE "Y" TO BUSINESS-ERROR
                               MOVE 1 TO RETURN-CODE
                           NOT INVALID KEY
                               PERFORM EMIT-TODO
                       END-REWRITE
               END-READ
           END-IF.

       SET-TODO-STATUS.
           PERFORM VALIDATE-ID
           PERFORM PREPARE-STATUS
           IF BUSINESS-ERROR = "N"
               PERFORM SET-CURRENT-STAMP
               PERFORM SET-TODO-KEY
               READ DB-FILE KEY IS DB-KEY
                   INVALID KEY
                       PERFORM FAIL-NOT-FOUND
                   NOT INVALID KEY
                       MOVE INPUT-STATUS TO TODO-STATUS
                       MOVE CURRENT-STAMP TO TODO-UPDATED
                       REWRITE DB-RECORD
                           INVALID KEY
                               DISPLAY "ERR|rewrite failed"
                               MOVE "Y" TO BUSINESS-ERROR
                               MOVE 1 TO RETURN-CODE
                           NOT INVALID KEY
                               PERFORM EMIT-TODO
                       END-REWRITE
               END-READ
           END-IF.

       DELETE-TODO.
           PERFORM SET-TODO-KEY
           READ DB-FILE KEY IS DB-KEY
               INVALID KEY
                   PERFORM FAIL-NOT-FOUND
               NOT INVALID KEY
                   DELETE DB-FILE RECORD
                       INVALID KEY
                           DISPLAY "ERR|delete failed"
                           MOVE "Y" TO BUSINESS-ERROR
                           MOVE 1 TO RETURN-CODE
                       NOT INVALID KEY
                           DISPLAY "OK|deleted|" FUNCTION TRIM(INPUT-ID)
                   END-DELETE
           END-READ.

       LIST-TODOS.
           MOVE "TODO:" TO DB-KEY
           START DB-FILE KEY IS GREATER THAN DB-KEY
               INVALID KEY
                   CONTINUE
               NOT INVALID KEY
                   PERFORM UNTIL FILE-STATUS NOT = "00"
                       READ DB-FILE NEXT RECORD
                           AT END
                               MOVE "10" TO FILE-STATUS
                           NOT AT END
                               IF DB-KEY(1:5) = "TODO:"
                                   PERFORM EMIT-TODO
                               ELSE
                                   MOVE "10" TO FILE-STATUS
                               END-IF
                       END-READ
                   END-PERFORM
           END-START.

       SET-TODO-KEY.
           MOVE FUNCTION UPPER-CASE(FUNCTION TRIM(INPUT-ID)) TO INPUT-ID
           MOVE SPACES TO DB-KEY
           STRING "TODO:" DELIMITED BY SIZE
                  INPUT-ID DELIMITED BY SIZE
               INTO DB-KEY
           END-STRING.

       PREPARE-BUSINESS-FIELDS.
           PERFORM PREPARE-STATUS
           IF BUSINESS-ERROR = "N"
               MOVE FUNCTION TRIM(INPUT-TITLE) TO INPUT-TITLE
               IF FUNCTION TRIM(INPUT-TITLE) = SPACES
                   DISPLAY "ERR|title is required"
                   MOVE "Y" TO BUSINESS-ERROR
                   MOVE 1 TO RETURN-CODE
               ELSE
                   PERFORM SET-CURRENT-STAMP
               END-IF
           END-IF.

       PREPARE-STATUS.
           MOVE FUNCTION UPPER-CASE(FUNCTION TRIM(INPUT-STATUS))
               TO INPUT-STATUS
           IF FUNCTION TRIM(INPUT-STATUS) = SPACES
               MOVE "OPEN" TO INPUT-STATUS
           END-IF
           IF FUNCTION TRIM(INPUT-STATUS) NOT = "OPEN"
               AND FUNCTION TRIM(INPUT-STATUS) NOT = "DONE"
               DISPLAY "ERR|status must be OPEN or DONE"
               MOVE "Y" TO BUSINESS-ERROR
               MOVE 1 TO RETURN-CODE
           END-IF.

       VALIDATE-ID.
           MOVE FUNCTION UPPER-CASE(FUNCTION TRIM(INPUT-ID)) TO INPUT-ID
           IF FUNCTION TRIM(INPUT-ID) = SPACES
               DISPLAY "ERR|id is required"
               MOVE "Y" TO BUSINESS-ERROR
               MOVE 1 TO RETURN-CODE
           END-IF.

       SET-CURRENT-STAMP.
           ACCEPT CURRENT-DAY FROM DATE YYYYMMDD
           ACCEPT CURRENT-CLOCK FROM TIME
           STRING CURRENT-DAY DELIMITED BY SIZE
                  CURRENT-CLOCK(1:6) DELIMITED BY SIZE
               INTO CURRENT-STAMP
           END-STRING.

       GENERATE-ID.
           ACCEPT CURRENT-DAY FROM DATE YYYYMMDD
           ACCEPT CURRENT-CLOCK FROM TIME
           MOVE CURRENT-CLOCK(1:8) TO GENERATED-ID.

       FAIL-USAGE.
           DISPLAY "ERR|usage: todostore OP [FIELDS]"
           MOVE "Y" TO BUSINESS-ERROR
           MOVE 1 TO RETURN-CODE.

       FAIL-UNKNOWN.
           DISPLAY "ERR|unknown operation"
           MOVE "Y" TO BUSINESS-ERROR
           MOVE 1 TO RETURN-CODE.

       FAIL-NOT-FOUND.
           DISPLAY "ERR|not found"
           MOVE "Y" TO BUSINESS-ERROR
           MOVE 1 TO RETURN-CODE.

       EMIT-TODO.
           DISPLAY
               "TODO|"
               FUNCTION TRIM(TODO-ID) "|"
               FUNCTION TRIM(TODO-STATUS) "|"
               FUNCTION TRIM(TODO-CREATED) "|"
               FUNCTION TRIM(TODO-UPDATED) "|"
               FUNCTION TRIM(TODO-TITLE).
