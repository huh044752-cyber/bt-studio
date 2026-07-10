#ifndef BT_EXCEPTIONS_H
#define BT_EXCEPTIONS_H

#include <string>
#include <stdexcept>

namespace BT
{
class BehaviorTreeException : public std::exception
{
  public:

    BehaviorTreeException(const std::string& message):  message_(message)
    {}

    template <typename... SV>
    BehaviorTreeException(const SV&... args): message_(StrCat (args...))
    { }


    const char* what() const noexcept
    {
        return message_.c_str();
    }

  private:
    std::string message_;
};

// This errors are usually related to problems that "probably" require code refactoring
// to be fixed.
class LogicError: public BehaviorTreeException
{
  public:
    LogicError(const std::string& message):  BehaviorTreeException(message)
    {}

    template <typename... SV>
    LogicError(const SV&... args): BehaviorTreeException(args...)
    { }

};

// This errors are usually related to problems that are relted to data or conditions
// that happen only at run-time
class RuntimeError: public BehaviorTreeException
{
  public:
    RuntimeError(const std::string& message):  BehaviorTreeException(message)
    {}

    template <typename... SV>
    RuntimeError(const SV&... args): BehaviorTreeException(args...)
    { }
};


}

#endif
