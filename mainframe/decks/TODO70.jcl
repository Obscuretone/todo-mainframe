//TODO70   JOB (TODO),'TODO-70',CLASS=A,MSGCLASS=A,MSGLEVEL=(1,1)
//* ------------------------------------------------------------------
//* TODO-70 MAINFRAME COBOL DECK
//* Target host: Hercules + MVS 3.8J TK4-
//* Intent: compile/run the COBOL business program on the emulated OS.
//*
//* This deck is intentionally explicit JCL so the REST layer can later
//* submit operation-specific cards through the 3505 reader and collect
//* printer output from the MVS spool.
//*
//* Cataloged COBOL procedure names differ between MVS 3.8J builds.
//* Common names to try on TK4-/MVS systems are COBUCLG, COBCLG, or
//* a site-local COBOL compile-link-go PROC.
//* ------------------------------------------------------------------
//COBRUN  EXEC COBUCLG
//COB.SYSIN DD *
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TODO70MF.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 BANNER PIC X(64)
          VALUE 'TODO-70 COBOL RUNNING UNDER EMULATED MVS'.
       PROCEDURE DIVISION.
           DISPLAY BANNER.
           STOP RUN.
/*
//GO.SYSIN DD *
/*
//
